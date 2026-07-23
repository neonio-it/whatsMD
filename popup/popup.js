const btn = document.getElementById('exportBtn');
const statusEl = document.getElementById('status');

const DEFAULT_SETTINGS = {
  sttEnabled: true,
  sttEndpoint: 'http://100.74.40.75:9000',
  sttLanguage: 'pt',
  maxMessages: 100,
};

const $ = (id) => document.getElementById(id);

function setStatus(state, message) {
  statusEl.className = `status ${state}`;
  statusEl.textContent = message;
}

function setBar(frac) {
  $('progress').classList.remove('hidden');
  $('progressBar').style.width = `${Math.round(Math.min(1, Math.max(0, frac)) * 100)}%`;
}

function hideBar() {
  $('progress').classList.add('hidden');
}

// render unificado do progresso — a fase de download ocupa os primeiros 10%,
// a transcrição (o trabalho pesado, com progresso real) os 90% restantes.
function applyStatus(msg) {
  if (msg.state === 'loading') {
    btn.disabled = true;
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
    setBar(1);
    setStatus('done', `Salvo: ${msg.filename}`);
  } else if (msg.state === 'error') {
    btn.disabled = false;
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
  });
}

function saveSettings() {
  chrome.storage.local.set({
    sttEnabled: $('sttEnabled').checked,
    sttEndpoint: $('sttEndpoint').value.trim() || DEFAULT_SETTINGS.sttEndpoint,
    sttLanguage: $('sttLanguage').value.trim() || DEFAULT_SETTINGS.sttLanguage,
    maxMessages: Math.max(1, parseInt($('maxMessages').value, 10) || DEFAULT_SETTINGS.maxMessages),
  });
}

['sttEnabled', 'sttEndpoint', 'sttLanguage', 'maxMessages'].forEach((id) =>
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
  applyStatus(lastStatus);
});

// ---- Status vindo do background ----
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'status') applyStatus(msg);
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
