// inject.js — выполняется в MAIN world ДО скриптов страницы (run_at: document_start)
// Цель: фиксировать "невидимые" источники: eval, динамические script-теги, Worker, ServiceWorker, WASM
// Сами хуки максимально пассивные: только сообщают bg, ничего не блокируют.

(() => {
  const send = (kind, data) => {
    try {
      window.postMessage({ __sg: true, kind, data }, "*");
    } catch (e) {}
  };

  const safeStr = (x) => {
    try {
      if (x == null) return "";
      if (typeof x === "string") return x;
      return String(x);
    } catch {
      return "";
    }
  };

  const sample = (s, n) => {
    s = safeStr(s);
    return s.length > n ? s.slice(0, n) : s;
  };

  // === eval ===
  try {
    const origEval = window.eval;
    // не перезаписываем сам eval (это ломает direct eval-семантику),
    // но через геттер на toString отслеживать невозможно.
    // Делаем обёртку через Object.defineProperty на window.eval — это
    // меняет only indirect eval, что для отслеживания достаточно.
    Object.defineProperty(window, "eval", {
      configurable: true,
      writable: true,
      value: function (s) {
        try {
          send("source", {
            type: "eval",
            size: typeof s === "string" ? s.length : 0,
            sample: typeof s === "string" ? sample(s, 240) : "",
          });
        } catch (e) {}
        return origEval.apply(this, arguments);
      },
    });
  } catch (e) {}

  // === <script src="..."> setter ===
  try {
    const desc = Object.getOwnPropertyDescriptor(
      HTMLScriptElement.prototype,
      "src"
    );
    if (desc && desc.set && desc.get) {
      Object.defineProperty(HTMLScriptElement.prototype, "src", {
        configurable: true,
        enumerable: desc.enumerable,
        get: function () {
          return desc.get.call(this);
        },
        set: function (v) {
          try {
            send("source", { type: "script-src-set", url: safeStr(v) });
          } catch (e) {}
          return desc.set.call(this, v);
        },
      });
    }
  } catch (e) {}

  // === MutationObserver: всё что добавляется в DOM ===
  try {
    const handle = (n) => {
      if (!n || n.nodeType !== 1) return;
      const tag = n.tagName;
      if (tag === "SCRIPT") {
        if (n.src) send("source", { type: "script", url: safeStr(n.src) });
        else if (n.textContent)
          send("source", {
            type: "inline-script",
            size: n.textContent.length,
            sample: sample(n.textContent, 240),
          });
      } else if (tag === "LINK") {
        const rel = (n.rel || "").toLowerCase();
        if (rel.includes("stylesheet") || rel.includes("preload") || rel.includes("modulepreload")) {
          send("source", {
            type: "link-" + (rel || "?"),
            url: safeStr(n.href || n.getAttribute("href")),
          });
        }
      } else if (tag === "STYLE") {
        send("source", {
          type: "inline-style",
          size: (n.textContent || "").length,
          sample: sample(n.textContent || "", 240),
        });
      } else if (tag === "IFRAME" || tag === "FRAME") {
        const src = n.src || n.getAttribute("src");
        if (src) send("source", { type: tag.toLowerCase(), url: safeStr(src) });
      }
    };
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) handle(n);
      }
    });
    mo.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
    });
  } catch (e) {}

  // === Worker / SharedWorker ===
  try {
    const OW = window.Worker;
    if (OW) {
      function HookedWorker(url, opts) {
        try {
          send("source", { type: "worker", url: safeStr(url) });
        } catch (e) {}
        return new OW(url, opts);
      }
      HookedWorker.prototype = OW.prototype;
      window.Worker = HookedWorker;
    }
  } catch (e) {}
  try {
    const OS = window.SharedWorker;
    if (OS) {
      function HookedSW(url, opts) {
        try {
          send("source", { type: "sharedworker", url: safeStr(url) });
        } catch (e) {}
        return new OS(url, opts);
      }
      HookedSW.prototype = OS.prototype;
      window.SharedWorker = HookedSW;
    }
  } catch (e) {}

  // === ServiceWorker.register ===
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.register) {
      const orig = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = function (url, opts) {
        try {
          send("source", { type: "service-worker", url: safeStr(url) });
        } catch (e) {}
        return orig(url, opts);
      };
    }
  } catch (e) {}

  // === WebAssembly ===
  try {
    if (window.WebAssembly) {
      const oc = WebAssembly.compile;
      WebAssembly.compile = function (buf) {
        try {
          send("source", { type: "wasm-compile", size: buf && buf.byteLength | 0 });
        } catch (e) {}
        return oc.apply(this, arguments);
      };
      const oi = WebAssembly.instantiate;
      WebAssembly.instantiate = function (buf) {
        try {
          const sz = buf && buf.byteLength;
          send("source", {
            type: "wasm-instantiate",
            size: typeof sz === "number" ? sz : 0,
          });
        } catch (e) {}
        return oi.apply(this, arguments);
      };
      if (WebAssembly.compileStreaming) {
        const ocs = WebAssembly.compileStreaming;
        WebAssembly.compileStreaming = function (resp) {
          try {
            send("source", {
              type: "wasm-stream",
              url: resp && resp.url ? safeStr(resp.url) : "",
            });
          } catch (e) {}
          return ocs.apply(this, arguments);
        };
      }
    }
  } catch (e) {}

  // === XMLHttpRequest.open (для полноты, webRequest и так ловит) ===
  try {
    const XO = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      try {
        send("source", { type: "xhr-open", url: safeStr(url), method: safeStr(method) });
      } catch (e) {}
      return XO.apply(this, arguments);
    };
  } catch (e) {}

  // === fetch ===
  try {
    const of = window.fetch;
    if (of) {
      window.fetch = function (input, init) {
        try {
          const u = typeof input === "string" ? input : input && input.url;
          send("source", { type: "fetch", url: safeStr(u) });
        } catch (e) {}
        return of.apply(this, arguments);
      };
    }
  } catch (e) {}

  send("hook-ready", { href: location.href });
})();
