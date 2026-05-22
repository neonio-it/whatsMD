const btn = document.getElementById('exportBtn');
const statusEl = document.getElementById('status');

function setStatus(state, message) {
  statusEl.className = `status ${state}`;
  statusEl.textContent = message;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'status') {
    if (msg.state === 'loading') {
      btn.disabled = true;
      setStatus('loading', 'Exportando...');
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

  if (!tab.url || !tab.url.includes('web.whatsapp.com')) {
    setStatus('error', 'Abra o WhatsApp Web primeiro.');
    return;
  }

  btn.disabled = true;
  setStatus('loading', 'Capturando conversa...');

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content_script.js'],
  });
});
