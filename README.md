# site-grabber

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/manifest-v3-brightgreen.svg)]()
[![Platform](https://img.shields.io/badge/platform-Chromium-blue.svg)]()
[![No deps](https://img.shields.io/badge/dependencies-zero-success.svg)]()

A Chromium Manifest V3 extension for full-page archival, in-page JavaScript execution, and comprehensive source tracking — including runtime-injected scripts that conventional tools miss.

Works on Chromium-based browsers: Chrome, Edge, Brave, Cent. Zero runtime dependencies.

---

## What it does

Three features in one extension, each addressing a gap in the default browser tooling.

### 1. Archival — full-page ZIP dump

Produces a single ZIP containing everything that loaded for the current tab, plus a snapshot of the rendered DOM. Contents:

| File | Description |
|---|---|
| `<host>/<path>` | All network resources captured during the tab's lifetime — HTML, CSS, JS, images, fonts, media, JSON, WASM — preserved in their original directory tree |
| `_rendered_dom.html` | Snapshot of the DOM *after* JavaScript execution (what the user actually sees, not what the server sent) |
| `_computed_styles.css` | All CSS rules from `document.styleSheets`, including inline and dynamically inserted, excluding CORS-blocked sheets |
| `_manifest.json` | Index: page URL, capture timestamp, full request list with types and statuses, full runtime source list |

Resource type checkboxes (images, media, fonts, XHR, JS, CSS, DOM) filter what gets included.

ZIP packing uses the native `CompressionStream('deflate-raw')` — no JSZip, no zlib wrapper, no third-party code.

### 2. Console — in-page JavaScript execution

A text field that executes arbitrary JavaScript in the page's MAIN world.

- Full access to `window`, `document`, all globals defined by page scripts, and top-level `await`
- Both expressions (`document.cookie`) and statement bodies (`for (...) { ... }`) supported
- `console.log` / `warn` / `error` / `info` are intercepted and shown inline
- `Ctrl+Enter` to execute, `Ctrl+↑/↓` to navigate history

Unlike opening DevTools, this leaves no observable trace: `outerHeight` / `innerHeight` are unchanged, `debugger;`-timing tricks don't fire, no `chrome.debugger` attachment, no yellow infobar. Implementation uses `chrome.scripting.executeScript({ world: 'MAIN' })`, which is the cleanest API path for running code in the page context.

### 3. Sources — comprehensive resource tracking

Combines two data sources to produce a list of *everything* the page loaded or executed, including things the Network tab misses.

**Network layer** — captured via `chrome.webRequest`:
- `main_frame`, `sub_frame`, `stylesheet`, `script`, `image`, `font`, `media`, `xhr`, `fetch`, `websocket`, `ping`, `other`
- Includes iframe content and dynamically loaded resources

**Runtime layer** — captured via MAIN-world hooks injected at `document_start`:
- `eval(...)` calls (with 240-char preview)
- `<script>` tags appended via `appendChild` / `innerHTML` (tracked by `MutationObserver`)
- `<script>.src = ...` setter assignments
- Inline `<style>` and `<link>` (stylesheet / preload / modulepreload)
- `new Worker(...)`, `new SharedWorker(...)`, `serviceWorker.register(...)`
- `WebAssembly.compile` / `instantiate` / `compileStreaming` (with module size)
- `XMLHttpRequest.open` and `fetch` (also captured at the network layer)

UI: substring filter, network/hooks toggle, list export to `.txt`, click-to-copy URL.

## Why this exists

Three gaps motivated this:

1. **DevTools detection.** Many sites detect when DevTools is open and either obfuscate behavior, redirect, or refuse to load. Running JS in MAIN world via the scripting API sidesteps all standard detection heuristics.
2. **Hidden sources.** Modern sites load code in ways the Network tab doesn't surface cleanly — `eval`, dynamic script injection, Workers, WebAssembly modules loaded via streaming. A complete inventory needs runtime instrumentation, not just network capture.
3. **Archival without copy-paste.** Saving a fully rendered page (post-JS DOM + all assets + all dynamically loaded code) is surprisingly hard with stock browser features. "Save As → Webpage, complete" misses everything that loads after page load.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│ background.js  (service worker)                          │
│   • chrome.webRequest listeners                          │
│   • per-tab request aggregation                          │
│   • message router                                       │
└─────────────────────────┬────────────────────────────────┘
                          │ chrome.runtime messages
┌─────────────────────────┴────────────────────────────────┐
│ content.js  (isolated world)                             │
│   • injects inject.js into MAIN world                    │
│   • bridges page ↔ background messaging                  │
└─────────────────────────┬────────────────────────────────┘
                          │ window.postMessage
┌─────────────────────────┴────────────────────────────────┐
│ inject.js  (MAIN world, runs at document_start)          │
│   • hooks eval, Worker, WebAssembly, XHR, fetch          │
│   • MutationObserver for dynamic <script>/<link>/<style> │
│   • reports runtime-injected sources                     │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ popup.{html,css,js}  (extension UI)                      │
│   • three tabs: Download / Console / Sources             │
│   • zip.js — CompressionStream-based packer              │
└──────────────────────────────────────────────────────────┘
```

## Install

1. Clone this repo or download as ZIP and extract.
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`, etc.).
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the repo folder.
5. Pin the extension icon to the toolbar.

The extension begins observing requests and injecting MAIN-world hooks **the moment it's installed**. For a full inventory of a page that was already open, reload (F5) after installing.

## Limitations

- Cannot retroactively capture `eval` calls that fired *before* the extension was installed — reload to capture them
- Cannot decrypt WebSocket payloads — captures connection URLs only
- Cannot run on `chrome://`, `edge://`, `brave://`, or other internal pages (browser policy)
- Does not automatically cache `fetch`/`xhr` response bodies. They're re-requested when packed into the ZIP, which works for most public APIs (cookies are reused) but fails for one-shot POSTs, SSE streams, and other non-idempotent endpoints

## Project structure

```
site-grabber/
├── manifest.json       MV3 manifest
├── background.js       Service worker — webRequest, request aggregation
├── content.js          Content script bridge (content ↔ inject ↔ background)
├── inject.js           MAIN-world hooks (eval, MutationObserver, Worker, WASM, XHR, fetch)
├── popup.html          Extension popup UI (three tabs)
├── popup.css           Dark theme
├── popup.js            Popup logic — feature wiring for all three tabs
├── zip.js              ZIP packer (CompressionStream, zero deps)
├── LICENSE             MIT
└── README.md
```

## License

MIT — see [LICENSE](LICENSE).

## Status

Research / personal tool. Issues and pull requests welcome.
