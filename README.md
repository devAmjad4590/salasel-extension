# Salasel Extension

A Manifest V3 browser extension that removes YouTube distractions — one toggle per element. Companion to the [Salasel app](https://salasel.app), a YouTube playlist manager.

---

## What it does

Each distraction element has its own independent toggle. Nothing is hidden until you turn it on.

| Toggle | What it hides |
| --- | --- |
| Recommendation sidebar | The suggested videos column on watch pages |
| Up next / autoplay | The autoplay countdown and next-video card |
| End screen cards & annotations | Overlay cards and annotations at end of videos |
| Shorts shelf | Shorts rows on the homepage and search results |
| Comments section | The entire comments thread below videos |
| Homepage feed | Replaces youtube.com with a clean empty page |

Preferences are saved to `chrome.storage.sync` — they follow you across signed-in browsers and apply instantly without reloading the page.

---

## Installation

No build step required.

1. Clone or download this repo
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the repo folder
5. Pin the extension and open YouTube

---

## How it works

- **CSS injection** — hiding is done by writing a single `<style>` tag into the YouTube page. No DOM nodes are removed, so the page never breaks.
- **MutationObserver** — YouTube is a single-page app. An observer watches for navigation and re-applies the style tag so hidden elements stay hidden across page changes.
- **`chrome.storage.onChanged`** — when you flip a toggle in the popup, open YouTube tabs update immediately. No reload needed.
- **i18n** — the popup UI is available in Arabic (default) and English. Switch from the language selector in the popup footer.

---

## Project structure

```
├── manifest.json              MV3 manifest
├── src/
│   ├── content.js             Injected into YouTube — CSS injection + MutationObserver
│   ├── storage.js             Storage keys, defaults, and get/set helpers
│   ├── i18n.js                Translation dictionary (ar/en) and helpers
│   ├── popup.html             Popup markup
│   ├── popup.js               Popup logic — reads/writes storage, handles language switch
│   ├── popup.css              Popup styles
│   └── styles/
│       └── hide-rules.js      Maps each toggle key to its CSS selectors
├── public/
│   └── empty-home.html        Placeholder page resource (styles inlined in content.js)
└── icons/
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
```

---

## Tech

- Manifest V3
- Vanilla JS — no framework, no build step
- Chrome/Chromium (Firefox is a stretch goal)
- `chrome.storage.sync` for preferences

---

## Part of Salasel

[salasel.app](https://salasel.app)
