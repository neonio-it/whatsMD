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
    // /docs é a UI Swagger do whisper-asr-webservice — resposta 200 = serviço no ar
    const resp = await fetch(`${base}/docs`, { method: 'GET' });
    if (resp.ok) {
      result.className = 'status done';
      result.textContent = '✓ Conectado ao Whisper';
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
  if (lastStatus.state === 'loading') {
    btn.disabled = true;
    setStatus('loading', lastStatus.message || 'Exportando...');
  } else if (lastStatus.state === 'done') {
    setStatus('done', `Salvo: ${lastStatus.filename}`);
  } else if (lastStatus.state === 'error') {
    setStatus('error', lastStatus.message);
  }
});

// ---- Status vindo do background ----
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'status') {
    if (msg.state === 'loading') {
      btn.disabled = true;
      setStatus('loading', msg.message || 'Exportando...');
    } else if (msg.state === 'done') {
      btn.disabled = false;
      setStatus('done', `Salvo: ${msg.filename}`);
    } else if (msg.state === 'error') {
      btn.disabled = false;
      setStatus('error', msg.message);
    }
  }
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
