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

  // Um áudio/PTT só tem o blob carregado depois que o WhatsApp baixa a mídia
  // (normalmente já vem carregado ao entrar na conversa). Se o <audio> ainda
  // não tiver src blob, marcamos hadAudio mas sem dados — o usuário reproduz e
  // reexporta. O controle de play existe mesmo antes do blob, então serve para
  // detectar que a mensagem É um áudio.
  function findAudio(el) {
    const audioEl = el.querySelector('audio[src^="blob:"]');
    const isVoice =
      audioEl !== null ||
      el.querySelector(
        '[data-icon="audio-play"], [data-icon="ptt-status"], [data-icon="audio-download"], button[aria-label*="udio"], button[aria-label*="oice"]'
      ) !== null;
    return { audioEl, isVoice };
  }

  const messageEls = conversationPanel.querySelectorAll('[data-id]');
  const messages = await Promise.all(
    Array.from(messageEls).map(async (el) => {
      const textEl = el.querySelector('.copyable-text');
      const imgEl = el.querySelector('img[src^="blob:"], img[src*="mmg.whatsapp.net"]');
      const { audioEl, isVoice } = findAudio(el);

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

      const hadAudio = isVoice;
      const audioDataUrl = audioEl ? await blobUrlToDataUrl(audioEl.src) : null;

      if (!text && !hadImage && !hadAudio) return null;

      return { sender, time, date, text, hadImage, imageDataUrl, hadAudio, audioDataUrl };
    })
  );

  chrome.runtime.sendMessage({
    action: 'export',
    data: { contactName, messages: messages.filter(Boolean) },
  });
})();
