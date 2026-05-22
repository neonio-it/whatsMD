importScripts('utils/md_builder.js');

const BATCH_SIZE = 50;

function mimeToExt(mimeType) {
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  return map[mimeType] || 'jpg';
}

async function fetchBlob(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob;
  } catch {
    return null;
  }
}

async function processMessages(messages) {
  const result = [];
  let imageCounter = 0;

  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    const processed = await Promise.all(
      batch.map(async (msg) => {
        if (!msg.imageUrl) return msg;
        const blob = await fetchBlob(msg.imageUrl);
        if (!blob) {
          return { ...msg, hadImage: true, imageUrl: undefined };
        }
        imageCounter++;
        const ext = mimeToExt(blob.type);
        const padded = String(imageCounter).padStart(3, '0');
        const filename = `img_${padded}.${ext}`;
        return { ...msg, blob, imageFilename: filename, hadImage: true, imageUrl: undefined };
      })
    );
    result.push(...processed);
  }

  return result;
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
  return name.replace(/[^a-zA-Z0-9À-ɏ\s-]/g, '').trim().replace(/\s+/g, '-');
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  const mime = blob.type || 'application/octet-stream';
  return `data:${mime};base64,${btoa(binary)}`;
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
    handleExport(message.data).catch(console.error);
  }
  if (message.action === 'error') {
    notifyPopup('error', message.message);
  }
});

function notifyPopup(state, extra = {}) {
  chrome.runtime.sendMessage({ action: 'status', state, ...extra }).catch(() => {});
}

async function handleExport({ contactName, messages }) {
  notifyPopup('loading');

  const exportDate = new Date();
  const folderName = `WhatsMD/${safeFilename(contactName)}_${formatDateForFolder(exportDate)}`;
  const processed = await processMessages(messages);

  for (const msg of processed) {
    if (msg.blob && msg.imageFilename) {
      const dataUrl = await blobToDataUrl(msg.blob);
      await downloadDataUrl(dataUrl, `${folderName}/imagens/${msg.imageFilename}`);
      delete msg.blob;
    }
  }

  const exportedAt = formatDate(exportDate);
  const md = buildMarkdown(processed, { contactName, exportedAt, total: processed.length });

  const mdDataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(md);
  await downloadDataUrl(mdDataUrl, `${folderName}/conversa.md`);

  notifyPopup('done', { filename: `${folderName}/conversa.md` });
}
