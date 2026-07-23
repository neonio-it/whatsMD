importScripts('utils/md_builder.js');

const DEFAULT_SETTINGS = {
  sttEnabled: true,
  sttEndpoint: 'http://100.74.40.75:9000',
  sttLanguage: 'pt',
};

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEFAULT_SETTINGS, (s) => resolve({ ...DEFAULT_SETTINGS, ...s }));
  });
}

function mimeToExt(mimeType) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/ogg': 'ogg',
    'audio/opus': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/webm': 'webm',
  };
  return map[mimeType] || 'bin';
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

// Envia o áudio para o Whisper self-hosted (openai-whisper-asr-webservice).
// Endpoint: POST {base}/asr?task=transcribe&language=pt&output=txt&encode=true
// campo multipart: audio_file. Resposta: text/plain com a transcrição.
async function transcribe(dataUrl, settings) {
  const blob = await (await fetch(dataUrl)).blob();
  const ext = mimeToExt(dataUrlMime(dataUrl));
  const form = new FormData();
  form.append('audio_file', blob, `audio.${ext}`);

  const base = settings.sttEndpoint.replace(/\/+$/, '');
  const lang = settings.sttLanguage || 'pt';
  const url = `${base}/asr?task=transcribe&language=${encodeURIComponent(lang)}&output=txt&encode=true`;

  const resp = await fetch(url, { method: 'POST', body: form });
  if (!resp.ok) throw new Error(`STT HTTP ${resp.status}`);
  return (await resp.text()).trim();
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
  // progresso vindo do relay ("Baixando mídia x/y...") — persiste também
  if (message.action === 'status' && message.state === 'loading') {
    chrome.storage.local.set({
      lastStatus: { state: 'loading', message: message.message, t: Date.now() },
    });
  }
});

function notifyPopup(state, extra = {}) {
  chrome.runtime.sendMessage({ action: 'status', state, ...extra }).catch(() => {});
  // persiste pro popup poder mostrar o andamento mesmo se for fechado e reaberto
  chrome.storage.local.set({ lastStatus: { state, ...extra, t: Date.now() } });
}

async function handleExport({ contactName, messages }) {
  notifyPopup('loading');

  const settings = await getSettings();
  const exportDate = new Date();
  const folderName = `WhatsMD/${safeFilename(contactName)}_${formatDateForFolder(exportDate)}`;

  // Imagens
  let imageCounter = 0;
  for (const msg of messages) {
    if (!msg.imageDataUrl) continue;
    imageCounter++;
    const ext = mimeToExt(dataUrlMime(msg.imageDataUrl));
    msg.imageFilename = `img_${String(imageCounter).padStart(3, '0')}.${ext}`;
    await downloadDataUrl(msg.imageDataUrl, `${folderName}/imagens/${msg.imageFilename}`);
    delete msg.imageDataUrl;
  }

  // Áudios: salva o arquivo e (se habilitado) transcreve.
  // Sequencial de propósito — o pczin é CPU-only e divide núcleos com o servidor.
  const audioMsgs = messages.filter((m) => m.audioDataUrl);
  let audioCounter = 0;
  let done = 0;
  for (const msg of messages) {
    if (!msg.audioDataUrl) continue;
    audioCounter++;
    const ext = mimeToExt(dataUrlMime(msg.audioDataUrl));
    msg.audioFilename = `audio_${String(audioCounter).padStart(3, '0')}.${ext}`;
    await downloadDataUrl(msg.audioDataUrl, `${folderName}/audios/${msg.audioFilename}`);

    if (settings.sttEnabled) {
      done++;
      notifyPopup('loading', { message: `Transcrevendo áudio ${done}/${audioMsgs.length}...` });
      try {
        const t = await transcribe(msg.audioDataUrl, settings);
        msg.transcript = t || '';
        if (!t) msg.transcriptError = 'vazio';
      } catch (err) {
        console.error('Transcrição falhou:', err);
        msg.transcriptError = err.message;
      }
    }
    delete msg.audioDataUrl;
  }

  const exportedAt = formatDate(exportDate);
  const md = buildMarkdown(messages, { contactName, exportedAt, total: messages.length });

  const mdDataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(md);
  await downloadDataUrl(mdDataUrl, `${folderName}/conversa.md`);

  notifyPopup('done', { filename: `${folderName}/conversa.md` });
}
