(function () {
  if (window.location.hostname !== 'web.whatsapp.com') {
    chrome.runtime.sendMessage({ action: 'error', message: 'Abra o WhatsApp Web primeiro.' });
    return;
  }

  const conversationPanel = document.querySelector('[data-testid="conversation-panel-messages"]');
  if (!conversationPanel) {
    chrome.runtime.sendMessage({ action: 'error', message: 'Selecione uma conversa.' });
    return;
  }

  const contactNameEl =
    document.querySelector('[data-testid="conversation-info-header-chat-title"]') ||
    document.querySelector('header [title]');
  const contactName = contactNameEl
    ? contactNameEl.textContent.trim() || contactNameEl.getAttribute('title')
    : 'Conversa';

  const messageEls = conversationPanel.querySelectorAll('[data-id]');
  const messages = [];

  messageEls.forEach((el) => {
    const textEl = el.querySelector('.copyable-text');
    const imgEl = el.querySelector('img[src*="blob:"], img[src*="https://mmg"]');

    const timestampAttr = textEl ? textEl.getAttribute('data-pre-plain-text') : null;
    let sender = 'Você';
    let time = '';

    if (timestampAttr) {
      const match = timestampAttr.match(/\[(\d{2}:\d{2}(?::\d{2})?),\s*[\d/]+\]\s*(.*?):/);
      if (match) {
        time = match[1];
        sender = match[2].trim() || 'Você';
      }
    }

    const text = textEl ? textEl.innerText.trim() : '';
    const imageUrl = imgEl ? imgEl.src : null;

    if (!text && !imageUrl) return;

    messages.push({ sender, time, text, imageUrl });
  });

  chrome.runtime.sendMessage({
    action: 'export',
    data: { contactName, messages },
  });
})();
