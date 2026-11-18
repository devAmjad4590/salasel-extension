# Salasel Extension

A Manifest V3 browser extension that removes YouTube distractions — one toggle per element. Companion to [Salasel](https://salasel.app).

---

## What it does

Each distraction element has an independent toggle. Nothing is hidden until enabled.

| Toggle | What it hides |
| --- | --- |
| Recommendation sidebar | Suggested videos on watch pages |
| Up next / autoplay | Autoplay countdown and next-video card |
| End screen cards & annotations | End-video overlay cards and annotations |
| Shorts shelf | Shorts rows on home and search |
| Comments section | Comments thread |
| Homepage feed | Replaces youtube.com home with a clean empty page |

It also surfaces a **Continue watching** card on the YouTube homepage. Preferences live in
`chrome.storage.sync`; device-local Continue data and notes live in `chrome.storage.local`.

## Installation

No build step required.

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this repository folder.
5. Pin extension and open YouTube.

## How it works

- **CSS injection** hides enabled distractions through one managed `<style>` tag.
- **MutationObserver** reapplies preferences across YouTube SPA navigation.
- **`chrome.storage.onChanged`** updates open tabs without reload.
- **i18n** supports Arabic (default) and English from popup footer.
- **Notes panel** is per-video, supports side switching, and keeps choice in synced preferences.

## Continue watching

YouTube homepage card returns user to canonical Salasel playback for latest supported
podcast, standalone video, or playlist video. It never opens outbound YouTube watch URL and
does not restore playback position or write activity from YouTube browsing.

### Bridge

Salasel stores local progress in Zustand's `localStorage['progress-storage']`. Two content
scripts bridge same browser profile through `chrome.storage.local`:

1. **`src/salasel.js`** runs on `salasel.app`. It accepts only validated
   `state.latestActivity` v1 playback events. Events come from Salasel embedded player after
   YouTube reports playing. Greatest source `playedAt` wins; equal timestamps preserve first
   accepted item. Invalid, future, stale, and delayed records cannot replace newer state.
2. **`src/content.js`** runs on YouTube. On homepage it reads revalidated bridge record and
   injects existing quiet Continue card. Link is trusted `https://salasel.app/...` URL built
   from validated activity identity, never URL copied from local storage.

Fresh profile with no accepted activity shows no card. Notes and synced preference/distraction
settings remain separate from this local bridge.

### `chrome.storage.local` record

```js
{
  continueWatching: {
    version: 1,
    kind: 'podcast' | 'video' | 'playlist-video',
    contentId: 'pod_...' | 'YouTubeVideoId',
    mediaId: 'YouTubeVideoId',
    playlistId: 'PL...',             // playlist-video only
    playlistName: 'Series title',    // optional context
    title: 'Episode title',
    thumbnailId: 'YouTubeVideoId',
    destination: 'https://salasel.app/ar/podcast/pod_.../watch',
    playedAt: 1760000000000          // source player event time
  }
}
```

Validator requires exact route matching kind and identities, one of `ar`, `en`, or `ja`,
11-character YouTube IDs, safe podcast/playlist path segments, and no query, fragment,
credentials, origin escape, backslash, or traversal. It builds trusted Salasel URL after
validation. Unavailable podcast destination remains in Salasel, where app shows unavailable
content fallback.

### Legacy compatibility

Existing extension records and app `lastWatched` data remain usable only with exact playlist
and video IDs. They migrate to safe Arabic playlist route; valid `updatedAt` remains timestamp.
Extension does **not** infer exact video from `recentPlaylists` or completion history, and does
not fetch playlist JSON. This avoids inventing history with incomplete old data.

Thumbnails load from `https://img.youtube.com/vi/<thumbnailId>/sddefault.jpg`, falling back to
`https://i.ytimg.com/vi/<thumbnailId>/hqdefault.jpg` when first image fails.

## Project structure

```
├── manifest.json              MV3 manifest
├── src/
│   ├── content.js             YouTube CSS, Continue card, SPA handling
│   ├── salasel.js             Salasel activity and notes bridge
│   ├── storage.js             Storage keys, validation, sync/local helpers
│   ├── i18n.js                Translation dictionary
│   ├── notes.js / notes.css   YouTube note panel
│   ├── popup.html/js/css      Popup controls
│   └── styles/hide-rules.js   Toggle selector mapping
└── icons/                     Extension icons
```

## Manual test notes

1. **Salasel player → record saved.** With unpacked extension loaded, play a podcast, standalone
   video, then playlist video in Salasel. Inspect `chrome.storage.local.continueWatching` after
   each. Verify title/context, source `playedAt`, and canonical Salasel destination.
2. **Continue → Salasel.** Open YouTube home. Card must use current popup language/direction and
   Continue must open Salasel podcast/video/playlist route, never youtube.com. Check Arabic RTL
   and English LTR keyboard focus/activation.
3. **Safety and recovery.** On fresh profile card is absent. Test legacy exact playlist/video
   storage retains usable card. Invalid/future/stale activity does not replace newer card.
   Confirm notes and distraction preferences still work after activity updates.

## Tech

- Manifest V3
- Vanilla JavaScript, no framework/build step
- Chrome/Chromium; Firefox stretch goal
- `chrome.storage.sync` for preferences

## Part of Salasel

[https://salasel.app](https://salasel.app)


### Podcast detail/watch compatibility

Podcast metadata lives at `/ar/podcast/pod_...`; direct player/notes lives at `/ar/podcast/pod_.../watch` (also en/ja). New activity resumes at `/watch`. Exact legacy base destinations remain accepted and normalize to `/watch` without changing source time or identity. This applies both to app activity and previously stored extension records; invalid suffixes/query/fragment paths remain rejected. Reload the unpacked extension after source changes.
