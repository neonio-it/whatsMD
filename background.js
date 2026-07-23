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
// Transcreve via streaming: o serviço emite uma linha NDJSON por segmento
// ({progress, text}) → progresso REAL (segundos de áudio já transcritos ÷ total).
// onProgress(frac 0..1) é chamado a cada segmento. Retorna o texto final.
async function transcribeStream(dataUrl, settings, onProgress, timeoutMs) {
  const blob = await (await fetch(dataUrl)).blob();
  const ext = mimeToExt(dataUrlMime(dataUrl));
  const form = new FormData();
  form.append('audio_file', blob, `audio.${ext}`);

  const base = settings.sttEndpoint.replace(/\/+$/, '');
  const lang = settings.sttLanguage || 'pt';
  const url = `${base}/transcribe-stream?language=${encodeURIComponent(lang)}`;

  // timeout por áudio: uma inferência travada nunca mais congela a exportação
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { method: 'POST', body: form, signal: ctrl.signal });
    if (!resp.ok || !resp.body) throw new Error(`STT HTTP ${resp.status}`);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let finalText = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let obj;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        if (obj.error) throw new Error(obj.error);
        if (typeof obj.progress === 'number') onProgress(obj.progress);
        if (typeof obj.text === 'string') finalText = obj.text;
      }
    }
    return finalText.trim();
  } finally {
    clearTimeout(timer);
  }
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
  // progresso vindo do relay (fase de download) — persiste também
  if (message.action === 'status' && message.state === 'loading' && message.phase) {
    const { action, ...rest } = message;
    persistStatus(rest);
  }
});

function persistStatus(obj) {
  // persiste pro popup poder mostrar o andamento mesmo se for fechado e reaberto
  chrome.storage.local.set({ lastStatus: { ...obj, t: Date.now() } });
}

function notifyPopup(state, extra = {}) {
  const obj = { state, ...extra };
  chrome.runtime.sendMessage({ action: 'status', ...obj }).catch(() => {});
  persistStatus(obj);
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
  // A barra de progresso é pesada pela DURAÇÃO real de cada áudio (via audioSecs),
  // e dentro de cada áudio anda com o progresso REAL vindo do streaming.
  const audioMsgs = messages.filter((m) => m.audioDataUrl);
  const totalSecs = audioMsgs.reduce((sum, m) => sum + (m.audioSecs || 30), 0) || 1;
  let audioCounter = 0;
  let done = 0;
  let completedSecs = 0;
  for (const msg of messages) {
    if (!msg.audioDataUrl) continue;
    audioCounter++;
    const ext = mimeToExt(dataUrlMime(msg.audioDataUrl));
    msg.audioFilename = `audio_${String(audioCounter).padStart(3, '0')}.${ext}`;
    await downloadDataUrl(msg.audioDataUrl, `${folderName}/audios/${msg.audioFilename}`);

    if (settings.sttEnabled) {
      done++;
      const curSecs = msg.audioSecs || 30;
      const report = (segFrac) => {
        const overall = Math.min(1, (completedSecs + curSecs * segFrac) / totalSecs);
        notifyPopup('loading', { phase: 'stt', progress: overall, done, total: audioMsgs.length });
      };
      report(0);
      try {
        const t = await transcribeStream(msg.audioDataUrl, settings, report, 8 * 60 * 1000);
        msg.transcript = t || '';
        if (!t) msg.transcriptError = 'vazio';
      } catch (err) {
        console.error('Transcrição falhou:', err);
        msg.transcriptError = err.name === 'AbortError' ? 'tempo esgotado (áudio muito longo)' : err.message;
      }
      completedSecs += curSecs;
      report(0); // completedSecs já inclui este áudio → fecha a fatia dele
    }
    delete msg.audioDataUrl;
  }

  const exportedAt = formatDate(exportDate);
  const md = buildMarkdown(messages, { contactName, exportedAt, total: messages.length });

  const mdDataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(md);
  await downloadDataUrl(mdDataUrl, `${folderName}/conversa.md`);

  notifyPopup('done', { filename: `${folderName}/conversa.md` });
}
