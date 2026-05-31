// background.js — service worker MV3
// Слежение за всеми сетевыми запросами по табу + сбор runtime-источников из inject.js

const tabData = new Map(); // tabId -> { requests: [], hooked: [] }

function getTab(id) {
  if (!tabData.has(id)) tabData.set(id, { requests: [], hooked: [] });
  return tabData.get(id);
}

chrome.webRequest.onResponseStarted.addListener(
  (d) => {
    if (d.tabId < 0) return;
    const t = getTab(d.tabId);
    t.requests.push({
      url: d.url,
      method: d.method,
      type: d.type,
      statusCode: d.statusCode,
      fromCache: d.fromCache,
      initiator: d.initiator,
      timeStamp: d.timeStamp,
      frameId: d.frameId,
    });
    // soft cap
    if (t.requests.length > 8000) t.requests.splice(0, 1000);
  },
  { urls: ["<all_urls>"] }
);

// сброс при навигации main_frame
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId === 0) {
    tabData.set(d.tabId, { requests: [], hooked: [] });
  }
});

chrome.tabs.onRemoved.addListener((id) => tabData.delete(id));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // от content.js: runtime-перехваченный источник
  if (sender.tab && msg && msg.kind === "source") {
    const t = getTab(sender.tab.id);
    t.hooked.push({
      ...msg.data,
      frameUrl: msg.url || (sender.url || ""),
      ts: Date.now(),
    });
    if (t.hooked.length > 5000) t.hooked.splice(0, 1000);
    return;
  }

  // от popup: отдать накопленное
  if (msg && msg.cmd === "getSources") {
    const t = getTab(msg.tabId);
    sendResponse({ requests: t.requests, hooked: t.hooked });
    return true;
  }

  if (msg && msg.cmd === "clearSources") {
    tabData.set(msg.tabId, { requests: [], hooked: [] });
    sendResponse({ ok: true });
    return true;
  }
});
