// Content script ISOLATED world: ponte entre o popup/background (chrome.runtime)
// e o capture_main.js (MAIN world, via postMessage). O MAIN world não acessa
// chrome.runtime, e o isolated não acessa o WPP — cada lado faz sua parte.
const TAG = '__whatsmd';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'wmd-capture') {
    window.postMessage({ [TAG]: 'capture', maxMessages: msg.maxMessages }, window.origin);
    sendResponse({ ok: true }); // confirma que o relay existe nesta aba
  }
});

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || !e.data[TAG]) return;
  const kind = e.data[TAG];
  if (kind === 'result') {
    chrome.runtime.sendMessage({ action: 'export', data: e.data.data });
  } else if (kind === 'error') {
    chrome.runtime.sendMessage({ action: 'error', message: e.data.message });
  } else if (kind === 'progress') {
    chrome.runtime.sendMessage({
      action: 'status',
      state: 'loading',
      phase: e.data.phase,
      done: e.data.done,
      total: e.data.total,
    });
  }
});
