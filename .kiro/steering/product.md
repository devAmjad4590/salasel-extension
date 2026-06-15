# Salasel Extension — Product & Technical Steering

## Project Overview

Salasel Extension is a Manifest V3 browser extension that strips distractions out of
YouTube. It is the companion to the **Salasel app**, a frontend-only Next.js YouTube
playlist manager. The app and the extension share a focus: making YouTube a calmer,
more intentional place to learn and watch.

For now, the extension has **one job**: remove YouTube distractions. Each distraction
element can be toggled on or off independently from a popup UI, and every preference is
persisted via `chrome.storage.sync` so it follows the user across signed-in browsers.

### Goals

- Give the user granular control over which YouTube UI elements are hidden — one toggle
  per element, not a single global on/off switch.
- Hide elements instantly and reliably, including across YouTube's single-page-app
  navigation (no full page reloads).
- Ship with **all toggles off by default** — the extension changes nothing until the user
  explicitly opts into hiding an element. YouTube looks untouched on first install.
- Stay lightweight: vanilla JS, no build step required, no runtime frameworks.

## Feature Scope

### In scope for v1

A popup with an **individual toggle for each** of the following distraction elements:

| Element | What it hides |
| --- | --- |
| Recommendation sidebar | The `#secondary` column on watch pages |
| Up next / autoplay panel | The autoplay/up-next card in the sidebar |
| End screen cards & annotations | End-of-video overlay cards and annotations |
| Shorts shelf | Shorts shelves on the homepage and in search results |
| Comments section | The comments thread under videos |
| Homepage feed | The youtube.com homepage feed — replaced with a clean empty page when visiting youtube.com directly |

Each toggle:

- Is its own independent option.
- Is saved independently via `chrome.storage.sync`.
- Defaults to **off (element visible)** on first install.

### Explicitly out of scope for now

- Progress tracking / watch analytics.
- Translated subtitles.
- Any account/sync system beyond `chrome.storage.sync`.
- Deep integration with the Salasel app (shared auth, playlist sync, etc.).
- Theming or visual customization beyond hiding elements.

These are deferred deliberately to keep v1 small and shippable. See **Deferred Features**.

## File Structure

A flat, no-build-step layout. TypeScript is preferred where it adds clarity without a
build requirement; if a build step is introduced for TS, keep compiled output checked in
or built with a single `npm run build`.

```
salasel-extension/
├── manifest.json            # MV3 manifest
├── src/
│   ├── content.js           # Injected into YouTube: CSS injection + MutationObserver
│   ├── popup.html           # Popup markup (one toggle per element)
│   ├── popup.js             # Reads/writes chrome.storage.sync, renders toggle state
│   ├── popup.css            # Popup styling
│   ├── storage.js           # Storage keys, defaults, get/set helpers (shared)
│   └── styles/
│       └── hide-rules.js    # Map of feature key -> CSS selector(s) to hide
├── public/
│   └── empty-home.html      # Clean replacement page for the homepage feed
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md
```

> If TypeScript is adopted, mirror this under `src/*.ts` and emit to `dist/`. The manifest
> should point at the emitted JS. Do not adopt TS if it forces a heavier toolchain than a
> single `tsc` invocation.

## Key Technical Decisions

### Manifest V3

MV3 is required for new Chrome Web Store submissions and is the supported path going
forward. The extension uses a content script for DOM/CSS work; no background service
worker is needed for v1 since all logic is page-local and storage-driven. This keeps the
permission surface minimal (`storage` plus host access to YouTube).

### CSS injection to hide elements

Hiding is done by injecting a single `<style>` tag into the page rather than removing or
mutating individual DOM nodes.

Why:

- **Fast and flicker-free** — a stylesheet applies to matching elements the moment they
  render, including elements added later by YouTube's SPA.
- **Resilient** — we don't fight YouTube's renderer by deleting nodes it expects to exist;
  we just set `display: none`.
- **Trivially reversible** — toggling a feature off means rewriting the `<style>` content,
  not restoring removed DOM.

The content script maintains one managed `<style>` element. Its contents are rebuilt from
the set of currently-enabled toggles: each enabled feature contributes its selector(s)
(from `hide-rules.js`) to the stylesheet.

### MutationObserver for SPA navigation

YouTube is a single-page app — navigating between pages does not trigger a full reload, so
a one-time injection isn't enough. A `MutationObserver` watches the document for
navigation/content changes and re-applies the managed `<style>` tag (re-inserting it if
YouTube removed it, and ensuring the homepage replacement logic runs on the homepage).

The observer is debounced/guarded so it does minimal work: it only re-asserts the style
element's presence and re-evaluates the homepage condition, rather than re-querying the
whole DOM on every mutation.

### Homepage feed replacement

When the user is on `youtube.com` directly (the homepage feed), and that toggle is
enabled, the feed is replaced with a clean empty page (`empty-home.html` content) instead
of just hiding the feed grid. This avoids leaving an awkward blank scaffold and gives a
deliberate "clean slate" landing experience.

### Per-element toggle storage schema

Each distraction is a **separate key** in `chrome.storage.sync` so toggles are independent
and partial updates don't clobber each other.

Storage keys (all boolean, `true` = element is hidden):

```js
{
  hideRecommendationSidebar: false,  // #secondary
  hideUpNextAutoplay:        false,  // up next / autoplay panel
  hideEndScreenCards:        false,  // end screen cards & annotations
  hideShortsShelf:           false,  // shorts shelf (home + search)
  hideComments:              false,  // comments section
  hideHomepageFeed:          false   // homepage feed -> empty page
}
```

Rules:

- **All default to `false`** (visible) on first install. On load, read stored prefs and
  merge over these defaults so newly-added keys get a sensible default.
- Read with `chrome.storage.sync.get(DEFAULTS)` so missing keys fall back to defaults.
- Write each toggle independently with `chrome.storage.sync.set({ [key]: value })`.
- The content script subscribes to `chrome.storage.onChanged` and rebuilds the managed
  `<style>` immediately when any key changes — no page reload required.

### On-load behavior

On extension/content-script load, preferences are read from `chrome.storage.sync` and
applied **immediately** by building the managed `<style>` before/at first paint, so there
is no flash of distracting content where possible.

## Tech Constraints

- **Manifest V3**.
- **Vanilla JS** — no frameworks, no required build step.
- **TypeScript optional but preferred** if it doesn't add toolchain complexity.
- **Target Chrome/Chromium first**; Firefox compatibility is a stretch goal. Avoid
  Chrome-only APIs where a cross-browser equivalent exists, and keep the `browser`/`chrome`
  namespace difference in mind so a Firefox port stays cheap.

## Deferred Features (and why)

- **Progress tracking** — watch/learning analytics is a meaningfully larger feature with
  its own storage, UI, and privacy considerations. It belongs to the Salasel app's domain
  more than the distraction-blocker, so it waits until the core extension is solid.
- **Translated subtitles** — requires a translation pipeline and likely network/API access,
  expanding the permission surface and complexity well beyond "hide distractions." Deferred
  until there's a clear product need and a privacy-safe approach.

Both are noted here so the architecture (single content script, storage-driven toggles)
stays simple now and we don't over-engineer for features that aren't committed.

## Definition of Done — v1

- [ ] MV3 `manifest.json` with `storage` permission and YouTube host access only.
- [ ] Popup UI shows **six independent toggles**, one per distraction element.
- [ ] Each toggle reads from and writes to `chrome.storage.sync` independently.
- [ ] **All six toggles default to disabled (visible)** on a fresh install — YouTube is
      untouched until the user opts in.
- [ ] Distractions are hidden via an injected `<style>` tag (CSS injection), not DOM removal.
- [ ] A `MutationObserver` re-applies hiding correctly across YouTube SPA navigation.
- [ ] Homepage feed toggle replaces youtube.com homepage with a clean empty page.
- [ ] Preferences are read on load and applied immediately, minimizing flash of content.
- [ ] Changing a toggle in the popup updates open YouTube tabs without a reload.
- [ ] Works on current Chrome/Chromium. Firefox is not a blocker for v1.
