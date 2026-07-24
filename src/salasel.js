/**
 * salasel.js — content script injected into salasel.app pages only.
 *
 * Responsibilities:
 *  1. Read salasel.app's Zustand-persisted state from localStorage
 *     (`progress-storage`) and extract the single most-recent record:
 *     recentPlaylists[0] + that playlist's completedVideos array.
 *  2. Resolve playlist metadata (name, thumbnailId) and the playlist's ordered
 *     video list by fetching the public JSON the site already serves
 *     (same-origin, so no CORS issue and no host permission beyond salasel.app).
 *  3. Derive the resume video = first video in playlist order NOT marked complete
 *     (fallback: first video if all are complete or list is empty).
 *  4. Write a single self-contained record to chrome.storage.local so the YouTube
 *     content script can surface a "continue watching" card without any
 *     cross-origin fetch.
 *
 * Local-only: the only network request is to https://salasel.app/... public JSON.
 * Every localStorage/JSON access is guarded — on any error we fail silently and
 * leave the previously stored record untouched.
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
 * Safely read and parse salasel.app's progress-storage localStorage entry.
 * @returns {{
 *   completedVideos: Record<string,string[]>,
 *   recentPlaylists: string[],
 *   lastWatched: { playlistId: string, videoId: string, updatedAt?: number } | null
 * } | null}
 */
function readProgressState() {
  try {
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const state = parsed && parsed.state;
    if (!state || typeof state !== 'object') return null;

    const recentPlaylists = Array.isArray(state.recentPlaylists)
      ? state.recentPlaylists
      : [];
    const completedVideos =
      state.completedVideos && typeof state.completedVideos === 'object'
        ? state.completedVideos
        : {};

    // The web app persists the exact playlist + video the user last opened.
    // Preferred over the completed-videos heuristic when present and well-formed.
    const lw = state.lastWatched;
    const lastWatched =
      lw &&
      typeof lw === 'object' &&
      typeof lw.playlistId === 'string' &&
      lw.playlistId &&
      typeof lw.videoId === 'string' &&
      lw.videoId
        ? lw
        : null;

    return { completedVideos, recentPlaylists, lastWatched };
  } catch (_err) {
    // Malformed JSON / storage access denied — fail silently.
    return null;
  }
}

/**
 * Fetch and parse JSON from a same-origin salasel.app path.
 * @param {string} path
 * @returns {Promise<any|null>}
 */
async function fetchJson(path) {
  try {
    const res = await fetch(path, { credentials: 'omit' });
    if (!res.ok) return null;
    return await res.json();
  } catch (_err) {
    return null;
  }
}

/**
 * Derive the resume video id for a playlist: the first video (in the playlist's
 * natural order) that is NOT in the completed set. Falls back to the first video
 * when every video is completed or the list is empty.
 * @param {Record<string, {id:string}>} videosObj — ordered video map from videos/<id>.json
 * @param {Set<string>} completedSet
 * @returns {string|null} resume video id, or null if there are no videos
 */
function deriveResumeVideoId(videosObj, completedSet) {
  const ids = Object.keys(videosObj || {});
  if (ids.length === 0) return null;

  for (const id of ids) {
    if (!completedSet.has(id)) return id;
  }
  // All complete → fall back to the first video so the card still works.
  return ids[0];
}

/**
 * Build (or refresh) the continue-watching record from current salasel.app state
 * and persist it to chrome.storage.local. No-op (silent) when there is no usable
 * recent playlist.
 */
async function syncContinueWatching() {
  const progress = readProgressState();
  if (!progress) return;

  // Prefer the exact playlist the user last opened. The web app records this on
  // click; it's the source of truth for "what to resume." Fall back to the
  // most-recent playlist list when lastWatched isn't available yet (e.g. the web
  // app hasn't shipped its half, or the user's stored state predates the field).
  const playlistId = progress.lastWatched
    ? progress.lastWatched.playlistId
    : progress.recentPlaylists[0];
  if (!playlistId) return; // No recent activity yet → leave storage as-is.

  const completedVideoIds = Array.isArray(progress.completedVideos[playlistId])
    ? progress.completedVideos[playlistId]
    : [];

  // The exact video the user last clicked, when the web app provides it.
  const clickedVideoId =
    progress.lastWatched && progress.lastWatched.playlistId === playlistId
      ? progress.lastWatched.videoId
      : null;

  // Skip redundant work: if we already stored this exact playlist + resume video
  // + completed set, there's nothing new to compute.
  const existing = await getContinueWatching();
  if (
    existing &&
    existing.playlistId === playlistId &&
    (!clickedVideoId || existing.resumeVideoId === clickedVideoId) &&
    sameMembers(existing.completedVideoIds, completedVideoIds)
  ) {
    return;
  }

  // Resolve playlist metadata (name + thumbnailId) from playlists.json.
  const playlists = await fetchJson('/playlists.json');
  const meta = playlists && playlists[playlistId];

  // Resume target: the exact clicked video when known, otherwise derive it from
  // the ordered video list (first not-yet-completed video, first as fallback).
  let resumeVideoId = clickedVideoId;
  if (!resumeVideoId) {
    const videos = await fetchJson(`/videos/${encodeURIComponent(playlistId)}.json`);
    const completedSet = new Set(completedVideoIds);
    resumeVideoId = videos ? deriveResumeVideoId(videos, completedSet) : null;
  }

  // Without a resume target the card can't link anywhere — don't store a record.
  if (!resumeVideoId) return;

  const record = {
    playlistId,
    playlistName: (meta && meta.name) || '',
    thumbnailId: (meta && meta.thumbnailId) || resumeVideoId,
    resumeVideoId,
    completedVideoIds,
    updatedAt: Date.now(),
  };

  try {
    await setContinueWatching(record);
  } catch (_err) {
    // Storage write failed — fail silently.
  }
}

/**
 * Shallow set-equality for two id arrays (order-independent).
 * @param {string[]} a
 * @param {string[]} b
 * @returns {boolean}
 */
function sameMembers(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

// ─── Init ─────────────────────────────────────────────────────────────────────

(function init() {
  // Run once on load.
  syncContinueWatching();
  forwardNotesToWebApp();

  // Re-forward notes whenever the extension's notes store changes (e.g. the user
  // just took notes on a YouTube tab).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[NOTES_KEY]) {
      forwardNotesToWebApp();
    }
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
