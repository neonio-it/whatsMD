// Roda no MAIN world (mesmo contexto da página) junto com vendor/wppconnect-wa.js.
// Usa os módulos internos do WhatsApp via WPP para ler mensagens e baixar mídias —
// o DOM não expõe mais os blobs de áudio (WhatsApp toca via APIs internas), então
// scraping visual não funciona para voz. Comunicação com a extensão via postMessage
// (MAIN world não tem acesso a chrome.runtime).
(function () {
  const TAG = '__whatsmd';

  function post(kind, payload) {
    window.postMessage({ [TAG]: kind, ...payload }, window.origin);
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout ${label}`)), ms)),
    ]);
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }

  async function waitReady(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (window.WPP && window.WPP.isReady) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }

  // MsgStore/ChatStore são o que getMessages usa por baixo — quando o WhatsApp Web
  // atualiza e o wa-js fica incompatível, eles somem (visto na 2.3000.1044302058).
  // mediaOk sonda os módulos que downloadMedia usa (conferidos na 2.3000.1044725657):
  // uma atualização pode quebrar só a parte de mídia mantendo a leitura de texto.
  function healthInfo() {
    const WPP = window.WPP || {};
    const wa = WPP.whatsapp || {};
    const modulesOk = !!(wa.MsgStore && wa.ChatStore);
    const mediaOk =
      modulesOk &&
      typeof (WPP.chat && WPP.chat.downloadMedia) === 'function' &&
      !!(wa.MediaBlobCache && wa.OpaqueData && wa.MediaPrep);
    return {
      waVersion: (window.Debug && window.Debug.VERSION) || '',
      wppReady: !!WPP.isReady,
      modulesOk,
      mediaOk,
    };
  }

  // isReady dispara antes de todos os módulos resolverem — dá uma folga antes de
  // declarar o wa-js quebrado (evita falso negativo em máquina/conexão lenta)
  async function waitModules(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (healthInfo().modulesOk) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  const pad = (n) => String(n).padStart(2, '0');

  function fmtTime(epochSec) {
    const d = new Date(epochSec * 1000);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fmtDate(epochSec) {
    const d = new Date(epochSec * 1000);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  // tipos que não viram linha no markdown
  const SKIP_TYPES = new Set([
    'e2e_notification', 'notification_template', 'gp2', 'call_log',
    'protocol', 'revoked', 'ciphertext',
  ]);

  async function capture(maxMessages) {
    if (!(await waitReady(10000))) {
      post('error', { message: 'WhatsApp ainda carregando (WPP não pronto). Recarregue a página e tente de novo.' });
      return;
    }
    const WPP = window.WPP;

    if (!(await waitModules(5000))) {
      // wa-js quebrado de verdade — sinaliza para o popup cair no modo degradado
      // (scraping DOM: texto e imagens visíveis) em vez de recusar a exportação
      post('error', {
        message: `wa-js incompatível com o WhatsApp Web ${healthInfo().waVersion} — módulos internos não resolveram. Atualize vendor/wppconnect-wa.js (@wppconnect/wa-js no npm).`,
        fallbackDom: true,
      });
      return;
    }
    const health = healthInfo();

    const chat = WPP.chat.getActiveChat();
    if (!chat) {
      post('error', { message: 'Selecione uma conversa.' });
      return;
    }

    const chatId = (chat.id && chat.id._serialized) || String(chat.id);
    const contactName =
      chat.formattedTitle || chat.name || (chat.contact && chat.contact.name) || 'Conversa';

    let raw;
    try {
      // sem timeout, um getMessages pendurado (wa-js × WhatsApp Web) travava sem erro
      raw = await withTimeout(WPP.chat.getMessages(chatId, { count: maxMessages }), 90000, 'getMessages');
    } catch (err) {
      post('error', { message: `Falha ao ler mensagens: ${err.message}` });
      return;
    }

    // getMessages pode vir em qualquer ordem — garante cronológica
    raw = raw.filter((m) => m && !SKIP_TYPES.has(m.type)).sort((a, b) => (a.t || 0) - (b.t || 0));

    const mediaTotal = raw.filter((m) =>
      ['ptt', 'audio', 'image', 'document', 'video'].includes(m.type)
    ).length;
    let mediaDone = 0;
    let mediaFailed = 0;

    // Disjuntor: se os módulos de mídia já não resolvem, ou se os downloads falham
    // em sequência, para de tentar — cada tentativa quebrada pode segurar até 120s,
    // e o texto exporta do mesmo jeito (as mídias saem como [não exportada] no md)
    let skipDownloads = !health.mediaOk;
    let consecutiveFails = 0;
    const MAX_CONSECUTIVE_FAILS = 3;

    const messages = [];
    for (const m of raw) {
      const id = (m.id && m.id._serialized) || String(m.id || '');
      const fromMe = m.id && typeof m.id.fromMe === 'boolean' ? m.id.fromMe : !!m.fromMe;
      const sender = fromMe
        ? 'Você'
        : m.notifyName || (m.senderObj && (m.senderObj.formattedName || m.senderObj.pushname)) || contactName;

      const msg = {
        sender,
        time: m.t ? fmtTime(m.t) : '',
        date: m.t ? fmtDate(m.t) : '',
        text: '',
        hadImage: false,
        imageDataUrl: null,
        hadAudio: false,
        audioDataUrl: null,
        audioSecs: 0,
        hadDocument: false,
        documentDataUrl: null,
        documentFilename: '',
        hadVideo: false,
        videoDataUrl: null,
      };

      if (m.type === 'chat') {
        msg.text = m.body || '';
      } else if (m.type === 'image') {
        msg.hadImage = true;
        msg.text = m.caption || '';
      } else if (m.type === 'ptt' || m.type === 'audio') {
        msg.hadAudio = true;
        msg.audioSecs = Math.round(m.duration || 0);
      } else if (m.type === 'video') {
        msg.hadVideo = true;
        msg.text = m.caption || '';
      } else if (m.type === 'document') {
        msg.hadDocument = true;
        msg.documentFilename = m.filename || 'arquivo';
        msg.text = m.caption || '';
      } else if (m.type === 'sticker') {
        msg.text = '*[figurinha]*';
      } else if (m.type === 'location') {
        msg.text = '*[localização]*';
      } else {
        msg.text = m.body || m.caption || '';
      }

      if (msg.hadImage || msg.hadAudio || msg.hadDocument || msg.hadVideo) {
        mediaDone++;
        post('progress', { phase: 'download', done: mediaDone, total: mediaTotal });
        if (skipDownloads) {
          mediaFailed++;
        } else {
          try {
            // vídeos podem ser grandes → timeout maior
            const blob = await withTimeout(WPP.chat.downloadMedia(id), 120000, 'download');
            const dataUrl = blob ? await blobToDataUrl(blob) : null;
            if (!dataUrl) mediaFailed++;
            if (msg.hadImage) msg.imageDataUrl = dataUrl;
            else if (msg.hadAudio) msg.audioDataUrl = dataUrl;
            else if (msg.hadDocument) msg.documentDataUrl = dataUrl;
            else msg.videoDataUrl = dataUrl;
            consecutiveFails = dataUrl ? 0 : consecutiveFails + 1;
          } catch (err) {
            // mantém had*=true sem dataUrl — o md marca como não exportado,
            // e o loop segue para a próxima mídia em vez de congelar
            mediaFailed++;
            consecutiveFails++;
            console.warn('[WhatsMD] downloadMedia falhou:', id, err);
          }
          if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
            skipDownloads = true;
            console.warn(
              `[WhatsMD] ${MAX_CONSECUTIVE_FAILS} downloads seguidos falharam — pulando as mídias restantes (provável wa-js × WhatsApp Web)`
            );
          }
        }
      }

      if (!msg.text && !msg.hadImage && !msg.hadAudio && !msg.hadDocument && !msg.hadVideo)
        continue;
      messages.push(msg);
    }

    post('result', { data: { contactName, messages, waVersion: health.waVersion, mediaFailed } });
  }

  // Só os últimos N áudios: baixa e transcreve sem exportar o resto da conversa.
  // Não tem modo degradado — áudio só sai pelos módulos internos (DOM não expõe os blobs).
  async function captureAudios(audioCount) {
    if (!(await waitReady(10000))) {
      post('error', { message: 'WhatsApp ainda carregando (WPP não pronto). Recarregue a página e tente de novo.' });
      return;
    }
    const WPP = window.WPP;

    if (!(await waitModules(5000))) {
      post('error', {
        message: `wa-js incompatível com o WhatsApp Web ${healthInfo().waVersion} — áudios só saem pelos módulos internos. Atualize vendor/wppconnect-wa.js.`,
      });
      return;
    }
    const health = healthInfo();
    if (!health.mediaOk) {
      post('error', {
        message: `Módulos de mídia quebrados no WhatsApp Web ${health.waVersion} — não dá para baixar áudios. Atualize vendor/wppconnect-wa.js.`,
      });
      return;
    }

    const chat = WPP.chat.getActiveChat();
    if (!chat) {
      post('error', { message: 'Selecione uma conversa.' });
      return;
    }
    const chatId = (chat.id && chat.id._serialized) || String(chat.id);
    const contactName =
      chat.formattedTitle || chat.name || (chat.contact && chat.contact.name) || 'Conversa';

    // busca adaptativa: os N áudios podem estar espalhados entre muitas mensagens
    // de texto — dobra a janela até achá-los, até o teto (conversas enormes)
    let fetchCount = Math.max(100, audioCount * 10);
    let audios = [];
    for (;;) {
      let raw;
      try {
        // a janela adaptativa chega a 2000 msgs — timeout generoso, mas nunca infinito
        raw = await withTimeout(WPP.chat.getMessages(chatId, { count: fetchCount }), 90000, 'getMessages');
      } catch (err) {
        post('error', { message: `Falha ao ler mensagens: ${err.message}` });
        return;
      }
      audios = raw
        .filter((m) => m && (m.type === 'ptt' || m.type === 'audio'))
        .sort((a, b) => (a.t || 0) - (b.t || 0));
      // raw menor que o pedido = chegou no início da conversa, não há mais o que buscar
      if (audios.length >= audioCount || raw.length < fetchCount || fetchCount >= 2000) break;
      fetchCount = Math.min(2000, fetchCount * 2);
    }
    audios = audios.slice(-audioCount);
    if (!audios.length) {
      post('error', { message: 'Nenhum áudio encontrado na conversa (janela de busca: últimas ' + fetchCount + ' mensagens).' });
      return;
    }

    let mediaFailed = 0;
    let consecutiveFails = 0;
    let skipDownloads = false;
    const messages = [];
    let done = 0;
    for (const m of audios) {
      const id = (m.id && m.id._serialized) || String(m.id || '');
      const fromMe = m.id && typeof m.id.fromMe === 'boolean' ? m.id.fromMe : !!m.fromMe;
      const msg = {
        sender: fromMe
          ? 'Você'
          : m.notifyName || (m.senderObj && (m.senderObj.formattedName || m.senderObj.pushname)) || contactName,
        time: m.t ? fmtTime(m.t) : '',
        date: m.t ? fmtDate(m.t) : '',
        text: '',
        hadAudio: true,
        audioDataUrl: null,
        audioSecs: Math.round(m.duration || 0),
      };
      done++;
      post('progress', { phase: 'download', done, total: audios.length });
      if (skipDownloads) {
        mediaFailed++;
      } else {
        try {
          const blob = await withTimeout(WPP.chat.downloadMedia(id), 120000, 'download');
          msg.audioDataUrl = blob ? await blobToDataUrl(blob) : null;
          if (!msg.audioDataUrl) mediaFailed++;
          consecutiveFails = msg.audioDataUrl ? 0 : consecutiveFails + 1;
        } catch (err) {
          mediaFailed++;
          consecutiveFails++;
          console.warn('[WhatsMD] downloadMedia falhou:', id, err);
        }
        if (consecutiveFails >= 3) skipDownloads = true; // mesmo disjuntor da captura completa
      }
      messages.push(msg);
    }

    post('result', {
      data: { contactName, messages, waVersion: health.waVersion, mediaFailed, audioOnly: true },
    });
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data[TAG] !== 'capture') return;
    const run = e.data.audioOnly
      ? captureAudios(Math.max(1, e.data.audioCount || 10))
      : capture(e.data.maxMessages || 100);
    run.catch((err) => post('error', { message: `Falha na captura: ${err.message}` }));
  });

  // popup pergunta a saúde ao abrir (via relay) → responde versão do WhatsApp Web
  // e se os módulos do wa-js ainda resolvem nela
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data[TAG] !== 'health-check') return;
    post('health', healthInfo());
  });
})();
