// popup.js
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let activeTab;
let sourcesCache = { requests: [], hooked: [] };

(async () => {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = t;
  refreshSources();
})();

// === вкладки ===
$$(".tabs button").forEach(
  (b) =>
    (b.onclick = () => {
      $$(".tabs button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      $$(".panel").forEach((p) => p.classList.add("hidden"));
      $("#p-" + b.dataset.tab).classList.remove("hidden");
      if (b.dataset.tab === "sources") refreshSources();
    })
);

// =============================================================
// === DOWNLOAD ================================================
// =============================================================
$("#btn-download").onclick = downloadAll;

function urlToPath(u) {
  try {
    const url = new URL(u);
    let p = url.host + url.pathname;
    if (p.endsWith("/")) p += "index.html";
    if (url.search) {
      const qs = url.search.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
      const dot = p.lastIndexOf(".");
      if (dot > p.lastIndexOf("/")) p = p.slice(0, dot) + qs + p.slice(dot);
      else p += qs;
    }
    p = p.replace(/[<>:"|?*]/g, "_");
    if (!/\.[a-z0-9]{1,8}$/i.test(p) && !p.endsWith("/")) {
      // без расширения — добавим .bin позже исходя из content-type
    }
    return p;
  } catch {
    return "_unknown/" + Math.random().toString(36).slice(2);
  }
}

function extFromContentType(ct) {
  if (!ct) return "";
  ct = ct.split(";")[0].trim().toLowerCase();
  const map = {
    "text/html": ".html",
    "text/css": ".css",
    "text/javascript": ".js",
    "application/javascript": ".js",
    "application/x-javascript": ".js",
    "application/json": ".json",
    "application/xml": ".xml",
    "text/xml": ".xml",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/x-icon": ".ico",
    "image/vnd.microsoft.icon": ".ico",
    "font/woff": ".woff",
    "font/woff2": ".woff2",
    "font/ttf": ".ttf",
    "application/font-woff": ".woff",
    "application/font-woff2": ".woff2",
    "application/wasm": ".wasm",
  };
  return map[ct] || "";
}

async function downloadAll() {
  const log = $("#dl-log");
  log.textContent = "";
  $("#dl-hint").textContent = "сбор...";
  const append = (m) => {
    log.textContent += m + "\n";
    log.scrollTop = log.scrollHeight;
  };
  append("[*] получаю накопленный список запросов...");
  const data = await chrome.runtime.sendMessage({
    cmd: "getSources",
    tabId: activeTab.id,
  });
  sourcesCache = data || { requests: [], hooked: [] };
  const { requests, hooked } = sourcesCache;

  const allow = new Set(["main_frame", "sub_frame"]);
  if ($("#opt-css").checked) allow.add("stylesheet");
  if ($("#opt-js").checked) allow.add("script");
  if ($("#opt-img").checked) {
    allow.add("image");
    allow.add("imageset");
  }
  if ($("#opt-media").checked) {
    allow.add("media");
    allow.add("object");
  }
  if ($("#opt-fonts").checked) allow.add("font");
  if ($("#opt-xhr").checked) {
    allow.add("xmlhttprequest");
    allow.add("fetch");
    allow.add("websocket");
    allow.add("other");
    allow.add("ping");
  }

  const seen = new Set();
  const queue = [];
  for (const r of requests) {
    if (!allow.has(r.type)) continue;
    if (
      r.url.startsWith("data:") ||
      r.url.startsWith("blob:") ||
      r.url.startsWith("chrome-extension:") ||
      r.url.startsWith("ws:") ||
      r.url.startsWith("wss:")
    )
      continue;
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    queue.push(r);
  }
  append(
    `[*] уникальных URL: ${queue.length} (всех запросов: ${requests.length}, runtime-источников: ${hooked.length})`
  );

  const files = [];
  let done = 0,
    fail = 0;
  const startTs = Date.now();

  // параллельно по 6
  const workers = 6;
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= queue.length) return;
      const r = queue[i];
      try {
        const resp = await fetch(r.url, {
          credentials: "include",
          cache: "force-cache",
          redirect: "follow",
        });
        const buf = new Uint8Array(await resp.arrayBuffer());
        let name = urlToPath(r.url);
        if (!/\.[a-z0-9]{1,8}$/i.test(name)) {
          const e = extFromContentType(resp.headers.get("content-type"));
          if (e) name += e;
        }
        // дедуп имён
        let final = name,
          k = 1;
        while (files.some((f) => f.name === final)) {
          const dot = name.lastIndexOf(".");
          if (dot > name.lastIndexOf("/"))
            final = name.slice(0, dot) + "_" + k + name.slice(dot);
          else final = name + "_" + k;
          k++;
        }
        files.push({ name: final, data: buf });
        done++;
      } catch (e) {
        fail++;
      }
      if ((done + fail) % 8 === 0)
        append(`    ${done}/${queue.length} (fail: ${fail})`);
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  append(`[+] скачано: ${done}, ошибок: ${fail}`);

  if ($("#opt-html").checked) {
    append("[*] снимаю rendered DOM...");
    try {
      const [{ result: domSnap }] = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        world: "MAIN",
        func: () =>
          "<!DOCTYPE html>\n<!-- Site Grabber: rendered DOM snapshot -->\n" +
          document.documentElement.outerHTML,
      });
      files.push({
        name: "_rendered_dom.html",
        data: new TextEncoder().encode(domSnap),
      });
      append(`[+] DOM snapshot: ${(domSnap.length / 1024).toFixed(1)} KB`);
    } catch (e) {
      append("[!] DOM snapshot failed: " + e.message);
    }

    // также соберём computed-stylesheets из CSSOM
    try {
      const [{ result: css }] = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        world: "MAIN",
        func: () => {
          const out = [];
          for (const s of document.styleSheets) {
            try {
              const rules = s.cssRules;
              if (!rules) continue;
              let txt = `/* === ${s.href || "[inline]"} === */\n`;
              for (const r of rules) txt += r.cssText + "\n";
              out.push(txt);
            } catch (e) {
              out.push(`/* === ${s.href || "[inline]"} === [CORS blocked] */`);
            }
          }
          return out.join("\n\n");
        },
      });
      if (css)
        files.push({
          name: "_computed_styles.css",
          data: new TextEncoder().encode(css),
        });
    } catch (e) {}
  }

  // manifest
  const manifest = {
    tool: "Site Grabber",
    version: "1.0.0",
    page_url: activeTab.url,
    page_title: activeTab.title,
    captured_at: new Date().toISOString(),
    elapsed_ms: Date.now() - startTs,
    total_network_requests: requests.length,
    saved_files: done,
    failed: fail,
    runtime_hidden_sources: hooked.length,
    requests_index: queue.map((r) => ({
      url: r.url,
      type: r.type,
      method: r.method,
      status: r.statusCode,
      from_cache: r.fromCache,
    })),
    runtime_hooks: hooked,
  };
  files.push({
    name: "_manifest.json",
    data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  });

  append("[*] упаковка ZIP...");
  const blob = await buildZip(files);
  const url = URL.createObjectURL(blob);
  const host = (() => {
    try {
      return new URL(activeTab.url).host.replace(/[^a-zA-Z0-9.-]/g, "_");
    } catch {
      return "site";
    }
  })();
  const fname = `${host}_${Date.now()}.zip`;
  await chrome.downloads.download({ url, filename: fname, saveAs: true });
  append(`[OK] ${fname} — ${(blob.size / 1024).toFixed(1)} KB`);
  $("#dl-hint").textContent = `${(blob.size / 1024).toFixed(1)} KB`;
}

// =============================================================
// === STEALTH CONSOLE =========================================
// =============================================================
const out = $("#console-output");
const inp = $("#console-input");
const history = [];
let histIdx = -1;

inp.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    runConsole();
  } else if (e.key === "ArrowUp" && e.ctrlKey) {
    e.preventDefault();
    if (histIdx < history.length - 1) {
      histIdx++;
      inp.value = history[history.length - 1 - histIdx];
    }
  } else if (e.key === "ArrowDown" && e.ctrlKey) {
    e.preventDefault();
    if (histIdx > 0) {
      histIdx--;
      inp.value = history[history.length - 1 - histIdx];
    } else {
      histIdx = -1;
      inp.value = "";
    }
  }
});
$("#btn-run").onclick = runConsole;
$("#btn-clear").onclick = () => (out.innerHTML = "");

async function runConsole() {
  const code = inp.value.trim();
  if (!code) return;
  history.push(code);
  histIdx = -1;

  const cmd = document.createElement("div");
  cmd.className = "cmd";
  cmd.textContent = "> " + code;
  out.appendChild(cmd);

  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id, allFrames: false },
      world: "MAIN",
      args: [code],
      func: async (src) => {
        const logs = [];
        const orig = {
          log: console.log,
          warn: console.warn,
          error: console.error,
          info: console.info,
          debug: console.debug,
        };
        const fmt = (a) => {
          try {
            if (a === null) return "null";
            if (a === undefined) return "undefined";
            if (typeof a === "string") return a;
            if (typeof a === "function") return a.toString();
            if (typeof a === "object")
              return JSON.stringify(
                a,
                (k, v) => (typeof v === "function" ? "[fn]" : v),
                2
              );
            return String(a);
          } catch (e) {
            try {
              return String(a);
            } catch {
              return "[?]";
            }
          }
        };
        const wrap = (lvl) =>
          function (...a) {
            try {
              logs.push(lvl + ": " + a.map(fmt).join(" "));
            } catch (e) {}
            try {
              orig[lvl].apply(console, a);
            } catch (e) {}
          };
        console.log = wrap("log");
        console.warn = wrap("warn");
        console.error = wrap("error");
        console.info = wrap("info");
        console.debug = wrap("debug");

        let result,
          err = null;
        try {
          // сначала пробуем как выражение, потом как стейтменты
          try {
            result = await new Function(
              "return (async()=> ( " + src + " ))();"
            )();
          } catch (e1) {
            if (e1 instanceof SyntaxError) {
              result = await new Function(
                "return (async()=>{ " + src + " })();"
              )();
            } else {
              throw e1;
            }
          }
        } catch (e) {
          err = e && (e.stack || e.message || String(e));
        }

        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
        console.info = orig.info;
        console.debug = orig.debug;

        let r;
        try {
          r = fmt(result);
        } catch (e) {
          r = "[unstringable]";
        }
        return { logs, result: r, err };
      },
    });

    const v = (res && res.result) || { logs: [], result: "undefined", err: null };
    if (v.logs.length) {
      const d = document.createElement("div");
      d.className = "out";
      d.textContent = v.logs.join("\n");
      out.appendChild(d);
    }
    if (v.err) {
      const d = document.createElement("div");
      d.className = "err";
      d.textContent = "✗ " + v.err;
      out.appendChild(d);
    } else {
      const d = document.createElement("div");
      d.className = "res";
      d.textContent = "← " + v.result;
      out.appendChild(d);
    }
  } catch (e) {
    const d = document.createElement("div");
    d.className = "err";
    d.textContent = "[exec error] " + (e.message || e);
    out.appendChild(d);
  }
  out.scrollTop = out.scrollHeight;
  inp.value = "";
  inp.focus();
}

// =============================================================
// === SOURCES =================================================
// =============================================================
$("#btn-refresh").onclick = refreshSources;
$("#src-filter").oninput = renderSources;
$("#btn-export-list").onclick = exportSourceList;
$("#src-net").onchange = renderSources;
$("#src-hk").onchange = renderSources;

async function refreshSources() {
  if (!activeTab) return;
  sourcesCache = await chrome.runtime.sendMessage({
    cmd: "getSources",
    tabId: activeTab.id,
  });
  if (!sourcesCache) sourcesCache = { requests: [], hooked: [] };
  renderSources();
}

function renderSources() {
  const f = $("#src-filter").value.toLowerCase();
  const showNet = $("#src-net").checked;
  const showHk = $("#src-hk").checked;
  const list = $("#src-list");
  list.innerHTML = "";

  const items = [];
  if (showNet) {
    for (const r of sourcesCache.requests) {
      items.push({
        kind: "net",
        label: `[${r.type}] ${r.statusCode}`,
        url: r.url,
        sort: r.timeStamp || 0,
      });
    }
  }
  if (showHk) {
    for (const h of sourcesCache.hooked) {
      let label = "[" + h.type + "]";
      let body = h.url || h.sample || (h.size ? `<${h.size}b>` : "");
      items.push({
        kind: "hk",
        label,
        url: body,
        sort: h.ts || 0,
      });
    }
  }

  items.sort((a, b) => a.sort - b.sort);

  let shown = 0;
  for (const it of items) {
    const txt = (it.label + " " + it.url).toLowerCase();
    if (f && !txt.includes(f)) continue;
    const d = document.createElement("div");
    d.className = "item " + it.kind;
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = it.label;
    const u = document.createElement("span");
    u.className = "u";
    u.textContent = it.url;
    d.appendChild(t);
    d.appendChild(u);
    d.title = "клик — копировать";
    d.onclick = () => {
      try {
        navigator.clipboard.writeText(it.url);
        d.style.background = "#1a3a1a";
        setTimeout(() => (d.style.background = ""), 300);
      } catch (e) {}
    };
    list.appendChild(d);
    shown++;
  }

  $("#src-stat").textContent =
    `${shown}/${items.length}  (net: ${sourcesCache.requests.length}, hk: ${sourcesCache.hooked.length})`;
}

function exportSourceList() {
  const lines = [];
  lines.push("# Site Grabber — sources dump");
  lines.push("# page: " + (activeTab && activeTab.url));
  lines.push("# at:   " + new Date().toISOString());
  lines.push("");
  lines.push("## Network requests (" + sourcesCache.requests.length + ")");
  for (const r of sourcesCache.requests) {
    lines.push(`[${r.type}] ${r.statusCode} ${r.method} ${r.url}`);
  }
  lines.push("");
  lines.push(
    "## Runtime / hidden sources (" + sourcesCache.hooked.length + ")"
  );
  for (const h of sourcesCache.hooked) {
    const url = h.url || "";
    const smp = h.sample ? " // " + h.sample.replace(/\n/g, " ").slice(0, 120) : "";
    const sz = h.size ? ` (${h.size}b)` : "";
    lines.push(`[${h.type}] ${url}${sz}${smp}`);
  }
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url,
    filename: "sources_" + Date.now() + ".txt",
    saveAs: true,
  });
}
