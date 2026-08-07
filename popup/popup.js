const btn = document.getElementById('exportBtn');
const statusEl = document.getElementById('status');
const bannerEl = document.getElementById('banner');

const DEFAULT_SETTINGS = {
  sttEnabled: true,
  sttEndpoint: 'http://100.74.40.75:9000',
  sttLanguage: 'pt',
  maxMessages: 100,
  audioCount: 10,
};

const $ = (id) => document.getElementById(id);

function setStatus(state, message) {
  statusEl.className = `status ${state}`;
  statusEl.textContent = message;
}

function showBanner(kind, message) {
  bannerEl.className = `banner ${kind}`;
  bannerEl.textContent = message;
}

function hideBanner() {
  bannerEl.className = 'banner hidden';
}

// saúde reportada pelo capture_main (via relay): avisa ANTES de exportar quando
// (a) o wa-js já quebrou nesta versão do WhatsApp Web, ou (b) a versão mudou
// desde a última exportação limpa. Desde a v1.8.0 a sonda é profunda (módulos de
// mídia inclusos), então (b) vira aviso informativo quando os módulos seguem OK —
// versão nova ≠ quebra (falso alarme era o caso comum).
function applyHealth(h) {
  if (h.wppReady && !h.modulesOk) {
    showBanner(
      'error',
      `wa-js incompatível com o WhatsApp Web ${h.waVersion} — exportação cai no modo degradado (só texto e imagens visíveis). Atualize vendor/wppconnect-wa.js.`
    );
    showUpdateCheck();
    return;
  }
  // mediaOk === undefined: relay antigo em cache, sem sonda profunda — não conclui nada
  if (h.wppReady && h.modulesOk && h.mediaOk === false) {
    showBanner(
      'error',
      `Os módulos de mídia quebraram no WhatsApp Web ${h.waVersion} — o texto exporta, mas mídias não vão baixar. Atualize vendor/wppconnect-wa.js.`
    );
    showUpdateCheck();
    return;
  }
  if (!h.waVersion) return;
  chrome.storage.local.get({ lastGoodWaVersion: '' }, ({ lastGoodWaVersion }) => {
    if (lastGoodWaVersion && lastGoodWaVersion !== h.waVersion) {
      if (h.mediaOk) {
        showBanner(
          'info',
          `WhatsApp Web atualizou (${lastGoodWaVersion} → ${h.waVersion}) e os módulos internos continuam OK — deve exportar normalmente. Este aviso some após a primeira exportação limpa.`
        );
      } else {
        showBanner(
          'warn',
          `WhatsApp Web atualizou (${lastGoodWaVersion} → ${h.waVersion}) desde a última exportação OK. Se mídias falharem, atualize o wa-js.`
        );
      }
    }
  });
}

// ---- Modo degradado: wa-js quebrou → scraping DOM (texto/imagens visíveis) ----
function runDomFallback(reason) {
  showBanner(
    'warn',
    `${reason} Exportando em modo degradado: só texto e imagens visíveis na tela — áudios, vídeos e documentos ficam de fora.`
  );
  showUpdateCheck();
  chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
    if (!tab || !tab.url || !tab.url.includes('web.whatsapp.com')) return;
    btn.disabled = true;
    setStatus('loading', 'Exportando (modo degradado)...');
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content_script.js'] });
    } catch {
      btn.disabled = false;
      setStatus('error', 'Modo degradado também falhou. Recarregue o WhatsApp Web (F5).');
    }
  });
}

// ---- "Saiu correção?": compara o wa-js vendorizado com o último do npm.
// GET só de metadados (nenhum dado do usuário), e só quando o usuário clica.
const updBtn = $('updateCheckBtn');

function showUpdateCheck() {
  updBtn.classList.remove('hidden');
}

updBtn.addEventListener('click', async () => {
  const result = $('updateResult');
  updBtn.disabled = true;
  result.className = 'status loading';
  result.textContent = 'Consultando npm...';
  try {
    const localTxt = await fetch(chrome.runtime.getURL('vendor/VERSION.txt')).then((r) => r.text());
    const local = (localTxt.match(/v?(\d+\.\d+\.\d+)/) || [])[1] || '?';
    const npm = await fetch('https://registry.npmjs.org/@wppconnect/wa-js/latest').then((r) => r.json());
    if (npm.version && npm.version !== local) {
      result.className = 'status done';
      result.textContent = `wa-js ${npm.version} disponível (você tem ${local}) — pode ser a correção. Como atualizar: docs/MANUTENCAO.md`;
    } else {
      result.className = 'status error';
      result.textContent = `Você já tem o wa-js mais recente (${local}) — a correção ainda não saiu. Acompanhe github.com/wppconnect-team/wa-js/releases.`;
    }
  } catch (err) {
    result.className = 'status error';
    result.textContent = `Não deu para consultar o npm: ${err.message}`;
  } finally {
    updBtn.disabled = false;
  }
});

function setBar(frac) {
  $('progress').classList.remove('hidden');
  $('progressBar').style.width = `${Math.round(Math.min(1, Math.max(0, frac)) * 100)}%`;
}

function hideBar() {
  $('progress').classList.add('hidden');
}

// render unificado do progresso — a fase de download ocupa os primeiros 10%,
// a transcrição (o trabalho pesado, com progresso real) os 90% restantes.
// restored = status recuperado do storage ao reabrir o popup; nesse caso ele não pode
// apagar o banner, porque o aviso de versão é informação mais nova que aquele status
function applyStatus(msg, restored) {
  if (msg.state === 'loading') {
    btn.disabled = true;
    $('audioBtn').disabled = true;
    let fill = 0;
    let label = msg.message || 'Exportando...';
    if (msg.phase === 'download') {
      fill = 0.1 * (msg.total ? msg.done / msg.total : 0);
      label = `Baixando mídia ${msg.done}/${msg.total}`;
    } else if (msg.phase === 'stt') {
      fill = 0.1 + 0.9 * (msg.progress || 0);
      label = `Transcrevendo áudio ${msg.done}/${msg.total} · ${Math.round((msg.progress || 0) * 100)}%`;
    }
    setBar(fill);
    setStatus('loading', label);
  } else if (msg.state === 'done') {
    btn.disabled = false;
    $('audioBtn').disabled = false;
    setBar(1);
    setStatus('done', `Salvo: ${msg.filename}`);
    // exportou mas com mídias faltando → provável wa-js × WhatsApp Web
    if (msg.warning) showBanner('warn', msg.warning);
    else if (!restored) hideBanner(); // exportação limpa: aviso de versão deixou de valer
  } else if (msg.state === 'error') {
    // wa-js quebrado → cai no scraping DOM em vez de só mostrar o erro.
    // restored = status antigo vindo do storage; não dispara exportação sozinho
    if (msg.fallbackDom && !restored) {
      runDomFallback(msg.message);
      return;
    }
    btn.disabled = false;
    $('audioBtn').disabled = false;
    hideBar();
    setStatus('error', msg.message);
  }
}

// ---- Configuração (chrome.storage.local) ----
function loadSettings() {
  chrome.storage.local.get(DEFAULT_SETTINGS, (s) => {
    $('sttEnabled').checked = s.sttEnabled;
    $('sttEndpoint').value = s.sttEndpoint;
    $('sttLanguage').value = s.sttLanguage;
    $('maxMessages').value = s.maxMessages;
    $('audioCount').value = s.audioCount;
  });
}

function saveSettings() {
  chrome.storage.local.set({
    sttEnabled: $('sttEnabled').checked,
    sttEndpoint: $('sttEndpoint').value.trim() || DEFAULT_SETTINGS.sttEndpoint,
    sttLanguage: $('sttLanguage').value.trim() || DEFAULT_SETTINGS.sttLanguage,
    maxMessages: Math.max(1, parseInt($('maxMessages').value, 10) || DEFAULT_SETTINGS.maxMessages),
    audioCount: Math.max(1, parseInt($('audioCount').value, 10) || DEFAULT_SETTINGS.audioCount),
  });
}

['sttEnabled', 'sttEndpoint', 'sttLanguage', 'maxMessages', 'audioCount'].forEach((id) =>
  $(id).addEventListener('change', saveSettings)
);

$('configToggle').addEventListener('click', () => {
  $('config').classList.toggle('hidden');
});

$('testBtn').addEventListener('click', async () => {
  const base = ($('sttEndpoint').value.trim() || DEFAULT_SETTINGS.sttEndpoint).replace(/\/+$/, '');
  const result = $('testResult');
  result.className = 'status loading';
  result.textContent = 'Testando...';
  try {
    // /health responde {ok, model} — 200 = serviço de transcrição no ar
    const resp = await fetch(`${base}/health`, { method: 'GET' });
    if (resp.ok) {
      const info = await resp.json().catch(() => ({}));
      result.className = 'status done';
      result.textContent = info.model ? `✓ Conectado (modelo ${info.model})` : '✓ Conectado ao Whisper';
    } else {
      result.className = 'status error';
      result.textContent = `Respondeu HTTP ${resp.status}`;
    }
  } catch (err) {
    result.className = 'status error';
    result.textContent = `Sem conexão: ${err.message}`;
  }
});

loadSettings();

// restaura o andamento se o popup foi fechado durante uma exportação
chrome.storage.local.get({ lastStatus: null }, ({ lastStatus }) => {
  if (!lastStatus) return;
  const age = Date.now() - (lastStatus.t || 0);
  if (age > 15 * 60 * 1000) return; // status velho não interessa
  applyStatus(lastStatus, true);
});

// ---- Status vindo do background ----
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'status') applyStatus(msg);
  if (msg.action === 'health') applyHealth(msg);
});

// ao abrir, pergunta a saúde à aba do WhatsApp (resposta assíncrona via 'health' acima);
// sem relay na aba (ou aba errada) o callback só engole o lastError
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab || !tab.url || !tab.url.includes('web.whatsapp.com')) return;
  chrome.tabs.sendMessage(tab.id, { action: 'wmd-health' }, () => void chrome.runtime.lastError);
});

btn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url || !tab.url.includes('web.whatsapp.com')) {
    setStatus('error', 'Abra o WhatsApp Web primeiro.');
    return;
  }

  btn.disabled = true;
  setStatus('loading', 'Capturando conversa...');

  // caminho principal: relay/WPP (lê mensagens e baixa mídias via módulos internos)
  chrome.storage.local.get(DEFAULT_SETTINGS, (s) => {
    chrome.tabs.sendMessage(tab.id, { action: 'wmd-capture', maxMessages: s.maxMessages }, async (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        // aba aberta antes da extensão carregar (sem relay) — fallback: scraping DOM
        // (exporta texto/imagens; áudios não são acessíveis via DOM)
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content_script.js'],
          });
        } catch {
          btn.disabled = false;
          setStatus('error', 'Não foi possível capturar. Recarregue o WhatsApp Web (F5) e tente de novo.');
        }
      }
    });
  });
});

// modo áudio: baixa e transcreve só os últimos N áudios da conversa.
// Sem fallback DOM — áudio depende dos módulos internos (DOM não expõe os blobs).
$('audioBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url || !tab.url.includes('web.whatsapp.com')) {
    setStatus('error', 'Abra o WhatsApp Web primeiro.');
    return;
  }

  btn.disabled = true;
  $('audioBtn').disabled = true;
  setStatus('loading', 'Procurando os últimos áudios...');

  chrome.storage.local.get(DEFAULT_SETTINGS, (s) => {
    chrome.tabs.sendMessage(
      tab.id,
      { action: 'wmd-capture', audioOnly: true, audioCount: s.audioCount },
      (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.ok) {
          btn.disabled = false;
          $('audioBtn').disabled = false;
          setStatus('error', 'Sem conexão com a aba. Recarregue o WhatsApp Web (F5) e tente de novo.');
        }
      }
    );
  });
});
