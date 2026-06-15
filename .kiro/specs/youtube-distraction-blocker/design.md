# Design — YouTube Distraction Blocker (v1)

## Overview

The extension is a Manifest V3 content-script-driven distraction blocker for YouTube. A
content script injects a single managed `<style>` element whose contents are derived from
the user's per-element toggle preferences. A popup UI reads and writes those preferences
to `chrome.storage.sync`, one boolean key per element. A MutationObserver keeps the style
tag present across YouTube's SPA navigation and re-evaluates the homepage replacement.

There is no background service worker in v1 — all logic is page-local (content script) and
UI-local (popup), coordinated only through `chrome.storage.sync` and its `onChanged` event.

## Architecture

```
        ┌─────────────┐     chrome.storage.sync (6 boolean keys)     ┌──────────────┐
        │   popup.js  │ ───────────────set/get────────────────────▶ │   storage    │
        │  (popup UI) │ ◀──────────────get──────────────────────────│  (synced)    │
        └─────────────┘                                              └──────┬───────┘
                                                                            │ onChanged
                                                                            ▼
                                                         ┌─────────────────────────────┐
                                                         │        content.js           │
                                                         │  - read prefs on load       │
                                                         │  - build managed <style>     │
                                                         │  - MutationObserver re-apply │
                                                         │  - homepage replacement      │
                                                         └─────────────────────────────┘
                                                                            │
                                                                            ▼
                                                                   YouTube page DOM
```

Shared modules:

- `storage.js` — single source of truth for keys, defaults, and get/set helpers. Imported
  (or included) by both popup and content script.
- `hide-rules.js` — maps each storage key to the CSS selector(s) that hide its element.

## Components and Interfaces

### storage.js

Defines the schema and access helpers so popup and content script never duplicate key
strings or defaults.

```js
const STORAGE_KEYS = {
  recommendationSidebar: 'hideRecommendationSidebar',
  upNextAutoplay:        'hideUpNextAutoplay',
  endScreenCards:        'hideEndScreenCards',
  shortsShelf:           'hideShortsShelf',
  comments:              'hideComments',
  homepageFeed:          'hideHomepageFeed',
};

// All default OFF (false = element visible).
const DEFAULTS = {
  hideRecommendationSidebar: false,
  hideUpNextAutoplay:        false,
  hideEndScreenCards:        false,
  hideShortsShelf:           false,
  hideComments:              false,
  hideHomepageFeed:          false,
};

function getPrefs() {            // returns Promise<prefs> merged over DEFAULTS
  return chrome.storage.sync.get(DEFAULTS);
}

function setPref(key, value) {   // writes one key, leaves others untouched
  return chrome.storage.sync.set({ [key]: value });
}
```

Reading with `get(DEFAULTS)` guarantees missing keys fall back to their default, satisfying
the off-by-default and missing-key requirements.

### hide-rules.js

Maps each storage key to the selector(s) whose `display` should be forced to `none`.
Selectors are kept here so they can be tuned as YouTube's DOM changes without touching
control flow.

```js
const HIDE_RULES = {
  hideRecommendationSidebar: ['#secondary'],
  hideUpNextAutoplay:        ['#secondary .ytp-autonav-endscreen-upnext-container',
                              'ytd-compact-autoplay-renderer'],
  hideEndScreenCards:        ['.ytp-ce-element', '.ytp-endscreen-content',
                              '.annotation'],
  hideShortsShelf:           ['ytd-rich-shelf-renderer[is-shorts]',
                              'ytd-reel-shelf-renderer',
                              'grid-shelf-view-model'],
  hideComments:              ['#comments', 'ytd-comments'],
  hideHomepageFeed:          ['ytd-browse[page-subtype="home"] #contents'],
};
```

> Selectors are best-effort against current YouTube markup and are expected to be adjusted
> over time. They live in one file precisely so that maintenance is localized.

### content.js

Responsibilities:

1. On load, call `getPrefs()` and build the managed `<style>`.
2. Maintain exactly one `<style id="salasel-hide">` element appended to `document.head`
   (or `documentElement` if head isn't ready yet).
3. Build the stylesheet text by concatenating selectors for every key whose value is
   `true`, each rule as `selector { display: none !important; }`.
4. Subscribe to `chrome.storage.onChanged` (area `sync`) and rebuild the stylesheet on any
   relevant key change.
5. Run a `MutationObserver` on `document` (or `document.documentElement`) that:
   - re-inserts the managed `<style>` if it has been removed, and
   - re-evaluates the homepage condition.
   The handler is debounced (e.g., via `requestAnimationFrame` or a short timeout) and does
   no broad DOM querying.
6. Homepage replacement: when `hideHomepageFeed` is `true` and the current URL is the
   YouTube homepage, render the clean empty page content into the feed container instead of
   merely hiding it. When the toggle is off or the route is not the homepage, do nothing /
   restore normal rendering.

Key function sketch:

```js
function buildStyleText(prefs) {
  let css = '';
  for (const key of Object.keys(HIDE_RULES)) {
    if (prefs[key]) {
      css += HIDE_RULES[key].map(sel => `${sel}{display:none !important;}`).join('');
    }
  }
  return css;
}

function applyPrefs(prefs) {
  const styleEl = ensureStyleEl();      // create-or-find #salasel-hide
  styleEl.textContent = buildStyleText(prefs);
  applyHomepage(prefs);                 // handle empty-home replacement
}
```

### popup.html / popup.js / popup.css

- `popup.html` declares six labeled checkbox/switch inputs, one per element, each tagged
  with its storage key (e.g., `data-key="hideComments"`).
- `popup.js` calls `getPrefs()` on open to set each input's checked state, and on change
  calls `setPref(key, checked)` for that single input only.
- `popup.css` styles the toggle list; no framework.

### empty-home.html

Static markup for the clean homepage replacement. The content script reads/clones this
markup (packaged as a web-accessible resource or inlined string) into the feed container
when homepage replacement is active.

### manifest.json (MV3)

```jsonc
{
  "manifest_version": 3,
  "name": "Salasel Extension",
  "version": "1.0.0",
  "permissions": ["storage"],
  "host_permissions": ["*://*.youtube.com/*"],
  "action": { "default_popup": "src/popup.html" },
  "content_scripts": [{
    "matches": ["*://*.youtube.com/*"],
    "js": ["src/storage.js", "src/styles/hide-rules.js", "src/content.js"],
    "run_at": "document_start"
  }],
  "web_accessible_resources": [{
    "resources": ["public/empty-home.html"],
    "matches": ["*://*.youtube.com/*"]
  }]
}
```

`run_at: document_start` lets the style tag be created as early as possible to minimize
flash of distracting content.

## Data Model

`chrome.storage.sync` holds six independent boolean keys (see `DEFAULTS`). `true` = hidden,
`false` = visible. No nested objects, so partial writes via `setPref` never clobber siblings
and `onChanged` reports per-key deltas.

## Error Handling

- **Missing keys:** `get(DEFAULTS)` supplies defaults; no key is ever `undefined` in use.
- **head not ready at document_start:** `ensureStyleEl()` falls back to appending to
  `document.documentElement` and the MutationObserver re-asserts placement once `head`
  exists.
- **Selector drift (YouTube markup changes):** isolated to `hide-rules.js`; a stale
  selector simply fails to hide its target and does not break other rules or the page.
- **Storage API errors:** get/set helpers surface promise rejections; popup degrades to
  showing defaults, content script keeps the last applied stylesheet.

## Testing Strategy

Manual verification against live YouTube for v1 (no automated DOM harness committed):

- Each toggle independently hides/shows its element and persists across reloads.
- Defaults are all OFF on a fresh profile (cleared storage) — YouTube untouched.
- Hidden elements stay hidden across SPA navigation (home → watch → search → home).
- Homepage replacement appears only on the homepage and only when its toggle is on.
- Changing a toggle updates an already-open YouTube tab without reload (via `onChanged`).
- Manifest loads cleanly in Chrome with only `storage` + YouTube host permissions.

Firefox is checked opportunistically (stretch goal) but is not part of the v1 pass/fail.
