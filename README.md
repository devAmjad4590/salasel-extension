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

It also surfaces a **continue watching** card on the YouTube homepage, based on the last
playlist you opened on [salasel.app](https://salasel.app).

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
- **Notes panel** — a per-video notes panel opens from a button in the player controls. It docks to the right by default; the "switch side" button (⇄) in the panel header flips it between right and left, and the choice is saved to `chrome.storage.sync`.

---

## Continue watching

The extension can resume the playlist you were last watching on salasel.app, directly from
the YouTube homepage.

### How the bridge works

salasel.app stores its progress in `localStorage` (under `progress-storage`, written by
Zustand's persist middleware). Browser extensions can't read another origin's
`localStorage` from a YouTube page, and salasel.app sends no CORS headers — so the bridge
is split across two content scripts joined by `chrome.storage.local`:

1. **`src/salasel.js`** runs **on salasel.app** (same-origin). It reads
   `localStorage['progress-storage']`. When the web app records `state.lastWatched`
   (the exact playlist + video the user last opened, **plus the playlist name**), that is
   used directly — the resume target *and* the display name/thumbnail all come straight from
   that record. Otherwise it falls back to the single most-recent playlist
   (`recentPlaylists[0]`) plus that playlist's `completedVideos` array and *derives* the
   resume video from the ordered video list. It then writes one self-contained record to
   `chrome.storage.local`.
2. **`src/content.js`** runs **on YouTube**. On the homepage it reads that record and
   injects an unobtrusive card (site theme color `#2e4b2c`) linking to the resume point. It
   makes **no cross-origin requests** — everything it needs is already in the record.

If no record exists (you've never opened salasel.app, or there's no progress yet), the card
simply doesn't appear — no error, no empty card.

### `chrome.storage.local` record shape

```js
{
  continueWatching: {
    playlistId:        'PL...',          // from lastWatched (or recentPlaylists[0])
    playlistName:      'أفلا يعقلون',     // from lastWatched.playlistName (may be '')
    thumbnailId:       'AYhLE8A5msA',     // lastWatched.thumbnailId, falls back to resumeVideoId
    resumeVideoId:     'F_feJ3zlp7w',     // derived (see below)
    completedVideoIds: ['id1', 'id2'],    // completedVideos[playlistId]
    updatedAt:         1719100000000      // Date.now() at write time
  }
}
```

### Resume-video derivation

The resume target is chosen in priority order:

**1. Exact last-clicked video (preferred).** If the web app persists
`state.lastWatched = { playlistId, videoId, playlistName, thumbnailId?, updatedAt }` — the
exact playlist and video the user last opened, plus the display name — the extension uses
that directly. This reflects *what the user actually clicked*, not a guess, and the playlist
name/thumbnail come from the same record (no JSON lookup, no network call). (Web-app side of
this contract lives in
[`.kiro/specs/youtube-distraction-blocker/salasel-webapp-last-watched-brief.md`](.kiro/specs/youtube-distraction-blocker/salasel-webapp-last-watched-brief.md).)

**2. Derived fallback.** When `lastWatched` is absent (the web app hasn't shipped its half,
or the stored state predates the field), the resume point is derived:

1. Take the most-recent playlist (`recentPlaylists[0]`).
2. Fetch the playlist's ordered video list from
   `https://salasel.app/videos/<playlistId>.json` (an ordered object of
   `{ id, title, duration, uploadedAt, playlistId }`).
3. The resume video is the **first video in playlist order that is not in
   `completedVideos`**.
4. **Final fallback:** if every video is completed (or the order can't be resolved), fall
   back to the **first video** in the playlist, so the card always links somewhere sensible.

The final link uses the same format the site uses for outbound links:

```
https://www.youtube.com/watch?v=<resumeVideoId>&list=<playlistId>
```

Thumbnails are loaded from `https://img.youtube.com/vi/<thumbnailId>/sddefault.jpg`, falling
back to `https://i.ytimg.com/vi/<thumbnailId>/hqdefault.jpg` if that 404s.

---

## Project structure

```
├── manifest.json              MV3 manifest
├── src/
│   ├── content.js             Injected into YouTube — CSS injection, MutationObserver, continue-watching card
│   ├── salasel.js             Injected into salasel.app — reads progress, derives resume video, writes the bridge record
│   ├── storage.js             Storage keys, defaults, sync + local helpers
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

## Manual test notes

1. **salasel.app → record saved.** Open salasel.app, play/mark progress in a playlist, then
   inspect the extension's storage (`chrome.storage.local`): a `continueWatching` record
   should be present with the expected `playlistId`, `resumeVideoId`, and
   `completedVideoIds`.
2. **YouTube home → card appears.** Open `https://www.youtube.com/`. The continue-watching
   card should show the playlist name + thumbnail, and **Continue** should link to
   `https://www.youtube.com/watch?v=<resumeVideoId>&list=<playlistId>`.
3. **No progress → no card.** On a fresh profile that has never visited salasel.app, the
   YouTube homepage shows no card and logs no errors.

---

## Tech

- Manifest V3
- Vanilla JS — no framework, no build step
- Chrome/Chromium (Firefox is a stretch goal)
- `chrome.storage.sync` for preferences

---

## Part of Salasel

[salasel.app](https://salasel.app)
