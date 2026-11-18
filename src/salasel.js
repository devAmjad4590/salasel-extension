/**
 * salasel.js — content script injected into salasel.app pages only.
 *
 * Responsibilities:
 *  1. Read Salasel's persisted v1 playback activity from `progress-storage`.
 *  2. Validate identities and canonical route through storage.js, then write a
 *     trusted, self-contained Salasel destination to chrome.storage.local.
 *  3. Fall back only to an exact legacy playlist/video record; never infer a
 *     resume target from browsing history or fetch playlist data.
 *
 * Every localStorage/JSON access is guarded. Invalid activity leaves the newest
 * previously accepted record untouched. Notes handoff remains independent.
 *
 * Depends on storage.js (getContinueWatching, setContinueWatching) being declared
 * first in the manifest content_scripts list for this match.
 */

'use strict';

const PROGRESS_STORAGE_KEY = 'progress-storage';

/**
 * Forward the extension's notes store to the Salasel web app via the page's
 * localStorage inbox + a live CustomEvent. Read-only w.r.t. chrome.storage: it
 * reads the Notes_Store and never mutates it. Best-effort; fails silently.
 */
async function forwardNotesToWebApp() {
  let store;
  try {
    store = await getNotesStore();
  } catch (_err) {
    // Read failed — leave the store untouched and surface nothing.
    return;
  }

  let payload;
  try {
    payload = buildNotesHandoffPayload(store);
  } catch (_err) {
    return;
  }

  try {
    window.localStorage.setItem(NOTES_INBOX_KEY, JSON.stringify(payload));
  } catch (_err) {
    // localStorage may be full/blocked — skip the durable channel.
  }

  try {
    window.dispatchEvent(new CustomEvent(NOTES_UPDATED_EVT, {
      detail: { source: 'salasel-extension', version: NOTES_HANDOFF_VERSION },
    }));
  } catch (_err) {
    // Event dispatch failed — nothing more to do.
  }
}

/**
 * Import notes the Salasel web app pushed to us (app→extension). Reads the
 * page's localStorage outbox, validates the envelope, and merges each record
 * into the extension's Notes_Store with last-write-wins on updatedAt. Never
 * deletes and never throws — best-effort, fails silently.
 */
async function importNotesFromWebApp() {
  let raw;
  try {
    raw = window.localStorage.getItem(NOTES_OUTBOX_KEY);
  } catch (_err) {
    // localStorage access blocked — nothing to import.
    return;
  }
  if (!raw) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (_err) {
    // Malformed JSON — ignore.
    return;
  }

  const incoming = extractHandoffNotes(payload);
  if (!incoming) return; // Wrong source/version or no notes.

  try {
    await mergeIncomingNotes(incoming);
  } catch (_err) {
    // Merge/write failed — fail silently.
  }
}

/** Safely read v1 activity plus an exact legacy record from persisted Zustand state. */
function readProgressState() {
  try {
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const state = parsed && parsed.state;
    if (!state || typeof state !== 'object') return null;
    return { latestActivity: state.latestActivity, lastWatched: state.lastWatched };
  } catch (_err) {
    return null;
  }
}

/** Converts only an exact legacy playlist/video observation into v1 activity. */
function legacyActivity(lastWatched) {
  if (!lastWatched || typeof lastWatched !== 'object' ||
      !Number.isFinite(lastWatched.updatedAt) || lastWatched.updatedAt < 0) return null;
  return {
    version: 1,
    kind: 'playlist-video',
    contentId: lastWatched.videoId,
    mediaId: lastWatched.videoId,
    playlistId: lastWatched.playlistId,
    playlistName: lastWatched.playlistName,
    title: typeof lastWatched.playlistName === 'string' && lastWatched.playlistName.trim()
      ? lastWatched.playlistName
      : 'Salasel playlist',
    thumbnailId: lastWatched.thumbnailId,
    destination: `/ar/playlist/${lastWatched.playlistId}/${lastWatched.videoId}`,
    playedAt: lastWatched.updatedAt,
  };
}

/** The MV3 worker serializes cross-tab merges before writing chrome.storage.local. */
function syncContinueWatching() {
  const progress = readProgressState();
  if (!progress) return Promise.resolve(null);
  const candidate = createContinueWatchingRecord(progress.latestActivity) ||
    createContinueWatchingRecord(legacyActivity(progress.lastWatched));
  if (!candidate) return Promise.resolve(null);

  return updateContinueWatching(candidate).catch(() => null);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

(function init() {
  // Run once on load.
  syncContinueWatching();
  forwardNotesToWebApp();
  importNotesFromWebApp();

  // Re-forward notes whenever the extension's notes store changes (e.g. the user
  // just took notes on a YouTube tab).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[NOTES_KEY]) {
      forwardNotesToWebApp();
    }
  });

  // Re-import whenever the web app edits a note. The native `storage` event does
  // not fire in the tab that wrote it, so the app dispatches this CustomEvent on
  // the same window we listen on here.
  window.addEventListener(APP_NOTES_UPDATED_EVT, () => {
    importNotesFromWebApp();
  });

  // Cross-tab safety net: if the app wrote the outbox from another tab, the
  // native `storage` event does fire here — re-import on that too.
  window.addEventListener('storage', (e) => {
    if (!e.key || e.key === NOTES_OUTBOX_KEY) importNotesFromWebApp();
  });

  // salasel.app is a SPA — progress can change as the user navigates between
  // playlists or marks videos complete, all without a full page load. Re-sync on
  // every signal we can get, debounced so rapid changes coalesce.
  let timer = null;
  const scheduleSync = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      syncContinueWatching();
    }, 800);
  };

  // Back/forward navigation.
  window.addEventListener('popstate', scheduleSync);
  // Initial load / bfcache restore.
  window.addEventListener('pageshow', scheduleSync);
  // Returning to the tab.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync();
  });
  // Cross-tab localStorage writes (does not fire in the writing tab).
  window.addEventListener('storage', (e) => {
    if (!e.key || e.key === PROGRESS_STORAGE_KEY) scheduleSync();
  });

  // Next.js (and most SPA routers) navigate via history.pushState/replaceState,
  // which do NOT emit a 'popstate' event. Patch them so switching playlists
  // in-page triggers a re-sync. Guard against double-patching.
  if (!history.__salaselPatched) {
    const fire = () => window.dispatchEvent(new Event('salasel:navigate'));
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        fire();
        return result;
      };
    }
    history.__salaselPatched = true;
    window.addEventListener('salasel:navigate', scheduleSync);
  }

  // Backstop: progress can change with no navigation at all (e.g. marking a
  // video complete updates localStorage in place). Poll the progress key on a
  // light interval; syncContinueWatching() dedupes, so unchanged state is a
  // cheap no-op that never touches storage or the network.
  setInterval(scheduleSync, 5000);
})();
