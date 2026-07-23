(async function () {
  function reportError(message) {
    chrome.runtime.sendMessage({ action: 'error', message });
  }

  if (window.location.hostname !== 'web.whatsapp.com') {
    reportError('Abra o WhatsApp Web primeiro.');
    return;
  }

  // WhatsApp removeu a maioria dos data-testid; #main é o fallback estável
  const conversationPanel =
    document.querySelector('[data-testid="conversation-panel-messages"]') ||
    document.querySelector('#main');
  if (!conversationPanel || !conversationPanel.querySelector('[data-id]')) {
    reportError('Selecione uma conversa.');
    return;
  }

  const contactNameEl =
    document.querySelector('[data-testid="conversation-info-header-chat-title"]') ||
    document.querySelector('#main header span[dir="auto"]') ||
    document.querySelector('header [title]');
  const contactName = contactNameEl
    ? contactNameEl.textContent.trim() || contactNameEl.getAttribute('title') || 'Conversa'
    : 'Conversa';

  // blob: só é acessível no contexto da página — o service worker não consegue
  // buscá-lo, então a conversão para data URL precisa acontecer aqui
  function blobUrlToDataUrl(url) {
    return fetch(url)
      .then((r) => (r.ok ? r.blob() : null))
      .then(
        (blob) =>
          blob &&
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          })
      )
      .catch(() => null);
  }

  const messageEls = conversationPanel.querySelectorAll('[data-id]');
  const messages = await Promise.all(
    Array.from(messageEls).map(async (el) => {
      const textEl = el.querySelector('.copyable-text');
      const imgEl = el.querySelector('img[src^="blob:"], img[src*="mmg.whatsapp.net"]');

      const isOutgoing =
        el.classList.contains('message-out') || el.querySelector('.message-out') !== null;
      let sender = isOutgoing ? 'Você' : contactName;
      let time = '';
      let date = '';

      const timestampAttr = textEl ? textEl.getAttribute('data-pre-plain-text') : null;
      if (timestampAttr) {
        const match = timestampAttr.match(/\[(\d{1,2}:\d{2}(?::\d{2})?),\s*([\d/.-]+)\]\s*(.*?):\s*$/);
        if (match) {
          time = match[1];
          date = match[2];
          if (match[3].trim()) sender = match[3].trim();
        }
      }

      const text = textEl ? textEl.innerText.trim() : '';
      const hadImage = imgEl !== null;
      const imageDataUrl = imgEl ? await blobUrlToDataUrl(imgEl.src) : null;

      if (!text && !hadImage) return null;

      return { sender, time, date, text, hadImage, imageDataUrl };
    })
  );

  chrome.runtime.sendMessage({
    action: 'export',
    data: { contactName, messages: messages.filter(Boolean) },
  });
})();
