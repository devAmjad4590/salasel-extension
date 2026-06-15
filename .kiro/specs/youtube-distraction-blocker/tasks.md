# Implementation Plan — YouTube Distraction Blocker (v1)

- [ ] 1. Scaffold the extension and MV3 manifest
  - Create the directory layout (`src/`, `src/styles/`, `public/`, `icons/`).
  - Write `manifest.json` (MV3) with `storage` permission, `*://*.youtube.com/*` host
    access, the popup action, the content script entry, and `empty-home.html` as a
    web-accessible resource.
  - Add placeholder icons (16/48/128).
  - _Requirements: 8.1, 8.2, 8.3_

- [ ] 2. Implement the storage module
  - Create `src/storage.js` defining `STORAGE_KEYS`, `DEFAULTS` (all six keys `false`),
    `getPrefs()` using `chrome.storage.sync.get(DEFAULTS)`, and `setPref(key, value)` that
    writes a single key.
  - _Requirements: 2.1, 2.3, 2.4, 3.1_

- [ ] 3. Define the hide-rules selector map
  - Create `src/styles/hide-rules.js` mapping each storage key to its CSS selector(s) for
    sidebar, up next/autoplay, end screen cards & annotations, Shorts shelf, comments, and
    homepage feed.
  - _Requirements: 1.1, 4.1_

- [ ] 4. Build the popup UI
- [ ] 4.1 Create popup markup and styling
  - Write `src/popup.html` with six labeled toggle inputs, each carrying its `data-key`.
  - Write `src/popup.css` for a clean, framework-free toggle list.
  - _Requirements: 1.1_
- [ ] 4.2 Wire popup logic to storage
  - Write `src/popup.js` to call `getPrefs()` on open and set each toggle's state, and on
    change call `setPref(key, checked)` for that one toggle only.
  - _Requirements: 1.2, 2.1, 2.2_

- [ ] 5. Implement the content script core
- [ ] 5.1 Managed style element and stylesheet builder
  - In `src/content.js`, implement `ensureStyleEl()` (create-or-find `#salasel-hide`,
    falling back to `documentElement` if `head` is missing) and `buildStyleText(prefs)`
    that concatenates `display:none !important` rules for every enabled key.
  - _Requirements: 4.1, 4.2, 4.3_
- [ ] 5.2 Apply preferences on load
  - On script load (`document_start`), call `getPrefs()` and apply immediately so hiding
    happens before content paints where possible.
  - _Requirements: 6.1, 3.2_
- [ ] 5.3 React to storage changes
  - Subscribe to `chrome.storage.onChanged` (sync area) and rebuild the stylesheet on any
    relevant key change so open tabs update without reload.
  - _Requirements: 6.2, 4.2_

- [ ] 6. Keep hiding consistent across SPA navigation
  - Add a debounced `MutationObserver` that re-inserts the managed `<style>` if removed and
    re-evaluates the homepage condition, doing minimal work per fire.
  - _Requirements: 5.1, 5.2, 5.3_

- [ ] 7. Implement homepage feed replacement
  - Create `public/empty-home.html` (clean empty page markup).
  - In `content.js`, when `hideHomepageFeed` is true and the route is the YouTube homepage,
    replace the feed with the empty page content; otherwise leave the homepage normal and
    do not apply it to non-homepage routes.
  - _Requirements: 7.1, 7.2, 7.3_

- [ ] 8. Manual verification pass
  - Verify on a fresh profile that all toggles default OFF and YouTube is untouched.
  - Verify each toggle independently hides/shows and persists across reloads.
  - Verify hidden state survives SPA navigation and that toggling updates an open tab
    without reload.
  - Verify homepage replacement appears only on the homepage when its toggle is on.
  - Confirm the manifest loads with only `storage` + YouTube host permissions.
  - _Requirements: 1.3, 1.4, 2.2, 3.1, 3.2, 5.1, 6.2, 7.1, 8.4_
