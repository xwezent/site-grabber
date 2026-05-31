# Site Grabber & Stealth Console

Расширение для Chromium-браузеров (Cent Browser, Chrome, Edge, Brave). MV3.

## Установка

1. Открыть `cent://extensions` (или `chrome://extensions`).
2. Включить **Developer mode** (правый верхний угол).
3. Нажать **Load unpacked**.
4. Выбрать папку `C:\Users\xwezent\Desktop\site_grabber`.
5. Закрепить иконку расширения на тулбаре.

> Важно: расширение начинает наблюдать запросы и инжектит наблюдатель источников **с момента установки**. Если хочешь полный список ресурсов на странице, которая уже открыта — обнови её (F5) после установки.

## Три раздела

### 1. Download
Кнопка **Скачать всё (ZIP)** собирает архив с тем, что прошло через сеть на текущей вкладке + рендер DOM.

В архив попадает:
- `<host>/<path>` — все скачанные ресурсы (html, css, js, картинки, шрифты, медиа, json, wasm…) в виде дерева как на сервере;
- `_rendered_dom.html` — снимок DOM **после выполнения JS** (то, что реально на странице);
- `_computed_styles.css` — все правила из `document.styleSheets` (включая inline и dynamically inserted), без CORS-заблокированных;
- `_manifest.json` — индекс: page_url, captured_at, список запросов с типами/статусами, список runtime-перехваченных источников.

Чекбоксы фильтруют что включать (картинки/медиа/шрифты/xhr/js/css/DOM).

ZIP пакуется через встроенный `CompressionStream('deflate-raw')` — без зависимостей.

### 2. Console — stealth eval
Поле для произвольного JS в контексте страницы (MAIN world).

- **Не открывает devtools.** Сайт не видит признаков отладчика: `outerHeight`/`innerHeight` не меняются, `debugger;`-таймеры не срабатывают, `chrome.debugger` не присоединён, никакой жёлтой плашки сверху.
- **Полный доступ:** `window`, `document`, все глобальные скрипта, обычный `await`.
- **Ctrl+Enter** — выполнить.
- **Ctrl+↑/↓** — история.
- **console.log/warn/error/info** перехватываются и показываются в выводе.
- Поддержаны и выражения (`document.cookie`), и стейтменты (`for(...) ...; return ...`).

Технически: используется `chrome.scripting.executeScript({ world: 'MAIN' })`. Это самый чистый способ выполнить код в странице — он не виден ни одному из стандартных devtools-детекторов.

### 3. Sources — полный список
Объединяет два источника:

- **network** — всё что webRequest зафиксировал на этом табе: main_frame, sub_frame, stylesheet, script, image, font, media, xhr, fetch, websocket, ping, other. Включая динамически загруженное и iframe-ы.
- **runtime / hidden** — то что сайт запускает в обход сетевого слоя:
  - `eval(...)` — с превью первых 240 символов;
  - `script` теги добавленные через `appendChild`/`innerHTML` — отслеживаются `MutationObserver`;
  - `<script>.src = ...` setter;
  - inline `<style>` и `<link>` (stylesheet/preload/modulepreload);
  - `new Worker(...)`, `new SharedWorker(...)`, `serviceWorker.register(...)`;
  - `WebAssembly.compile/instantiate/compileStreaming` — с размером модуля;
  - `XMLHttpRequest.open` и `fetch` — для полноты картины (дублируется с network).

Работает фильтр (по подстроке), переключатели net/hk, экспорт списка в `.txt`. Клик по строке копирует URL в буфер.

## Что НЕ делает

- Не читает уже выполненные `eval` до установки расширения (нужен `F5`).
- Не дешифрует чужие WebSocket-сессии — ловит только URL подключения.
- Не работает на `chrome://`, `cent://`, `edge://`, internal-страницах (политика браузера).
- Не сохраняет ответы fetch/xhr автоматически — они идут в ZIP только если URL дозапрашиваем повторно с включённой опцией `xhr/fetch`. Для большинства публичных API повторный запрос сработает (с куками вкладки), но если ответ уникален (POST с одноразовым телом, server-sent events) — он не воспроизведётся.

## Структура

```
site_grabber/
├── manifest.json       MV3 манифест
├── background.js       service worker (webRequest, агрегация)
├── content.js          мост content↔inject↔background
├── inject.js           MAIN-world наблюдатели (eval, MutationObserver, Worker, WASM, ...)
├── popup.html          UI с тремя вкладками
├── popup.css           тёмная тема
├── popup.js            логика трёх разделов
├── zip.js              ZIP-сборщик (CompressionStream, без deps)
└── README.md           этот файл
```

## Лицензия

Личный инструмент. Делай с ним что хочешь.
