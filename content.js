// content.js — мост между MAIN-world inject.js и background
(() => {
  try {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("inject.js");
    s.async = false;
    (document.head || document.documentElement || document).appendChild(s);
    s.onload = () => {
      try {
        s.remove();
      } catch (e) {}
    };
  } catch (e) {
    // если head ещё нет, попробуем позже
    document.addEventListener("readystatechange", function once() {
      if (document.documentElement) {
        document.removeEventListener("readystatechange", once);
        try {
          const s = document.createElement("script");
          s.src = chrome.runtime.getURL("inject.js");
          s.async = false;
          document.documentElement.appendChild(s);
        } catch (e) {}
      }
    });
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__sg !== true) return;
    try {
      chrome.runtime.sendMessage({
        kind: d.kind,
        data: d.data,
        url: location.href,
      });
    } catch (err) {}
  });
})();
