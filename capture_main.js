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
      raw = await WPP.chat.getMessages(chatId, { count: maxMessages });
    } catch (err) {
      post('error', { message: `Falha ao ler mensagens: ${err.message}` });
      return;
    }

    // getMessages pode vir em qualquer ordem — garante cronológica
    raw = raw.filter((m) => m && !SKIP_TYPES.has(m.type)).sort((a, b) => (a.t || 0) - (b.t || 0));

    const mediaTotal = raw.filter((m) =>
      ['ptt', 'audio', 'image'].includes(m.type)
    ).length;
    let mediaDone = 0;

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
        msg.text = [m.caption, '*[vídeo não exportado]*'].filter(Boolean).join('\n');
      } else if (m.type === 'document') {
        msg.text = `*[documento: ${m.filename || 'arquivo'}]*`;
      } else if (m.type === 'sticker') {
        msg.text = '*[figurinha]*';
      } else if (m.type === 'location') {
        msg.text = '*[localização]*';
      } else {
        msg.text = m.body || m.caption || '';
      }

      if (msg.hadImage || msg.hadAudio) {
        mediaDone++;
        post('progress', { phase: 'download', done: mediaDone, total: mediaTotal });
        try {
          const blob = await withTimeout(WPP.chat.downloadMedia(id), 30000, 'download');
          const dataUrl = blob ? await blobToDataUrl(blob) : null;
          if (msg.hadImage) msg.imageDataUrl = dataUrl;
          else msg.audioDataUrl = dataUrl;
        } catch (err) {
          // mantém hadImage/hadAudio true sem dataUrl — o md marca como não exportada,
          // e o loop segue para a próxima mídia em vez de congelar
          console.warn('[WhatsMD] downloadMedia falhou:', id, err);
        }
      }

      if (!msg.text && !msg.hadImage && !msg.hadAudio) continue;
      messages.push(msg);
    }

    post('result', { data: { contactName, messages } });
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data[TAG] !== 'capture') return;
    capture(e.data.maxMessages || 100).catch((err) =>
      post('error', { message: `Falha na captura: ${err.message}` })
    );
  });
})();
