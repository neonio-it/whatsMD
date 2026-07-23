importScripts('utils/md_builder.js');

function mimeToExt(mimeType) {
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  return map[mimeType] || 'jpg';
}

function dataUrlMime(dataUrl) {
  const match = dataUrl.match(/^data:([^;,]+)/);
  return match ? match[1] : '';
}

function formatDate(date) {
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateForFolder(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}h${pad(date.getMinutes())}`;
}

function safeFilename(name) {
  const clean = name.replace(/[^a-zA-Z0-9À-ɏ\s-]/g, '').trim().replace(/\s+/g, '-');
  return clean || 'Conversa';
}

function downloadDataUrl(dataUrl, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url: dataUrl, filename, saveAs: false }, (id) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(id);
    });
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'export') {
    handleExport(message.data).catch((err) => {
      console.error(err);
      notifyPopup('error', { message: `Falha ao exportar: ${err.message}` });
    });
  }
  if (message.action === 'error') {
    notifyPopup('error', { message: message.message });
  }
});

function notifyPopup(state, extra = {}) {
  chrome.runtime.sendMessage({ action: 'status', state, ...extra }).catch(() => {});
}

async function handleExport({ contactName, messages }) {
  notifyPopup('loading');

  const exportDate = new Date();
  const folderName = `WhatsMD/${safeFilename(contactName)}_${formatDateForFolder(exportDate)}`;

  let imageCounter = 0;
  for (const msg of messages) {
    if (!msg.imageDataUrl) continue;
    imageCounter++;
    const ext = mimeToExt(dataUrlMime(msg.imageDataUrl));
    msg.imageFilename = `img_${String(imageCounter).padStart(3, '0')}.${ext}`;
    await downloadDataUrl(msg.imageDataUrl, `${folderName}/imagens/${msg.imageFilename}`);
    delete msg.imageDataUrl;
  }

  const exportedAt = formatDate(exportDate);
  const md = buildMarkdown(messages, { contactName, exportedAt, total: messages.length });

  const mdDataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(md);
  await downloadDataUrl(mdDataUrl, `${folderName}/conversa.md`);

  notifyPopup('done', { filename: `${folderName}/conversa.md` });
}
