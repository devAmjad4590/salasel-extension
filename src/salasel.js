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
 * Safely read and parse salasel.app's progress-storage localStorage entry.
 * @returns {{ completedVideos: Record<string,string[]>, recentPlaylists: string[] } | null}
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

    return { completedVideos, recentPlaylists };
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

  const playlistId = progress.recentPlaylists[0];
  if (!playlistId) return; // No recent activity yet → leave storage as-is.

  const completedVideoIds = Array.isArray(progress.completedVideos[playlistId])
    ? progress.completedVideos[playlistId]
    : [];

  // Skip redundant work: if we already stored this exact playlist + completed
  // set, there's nothing new to compute.
  const existing = await getContinueWatching();
  if (
    existing &&
    existing.playlistId === playlistId &&
    sameMembers(existing.completedVideoIds, completedVideoIds)
  ) {
    return;
  }

  // Resolve playlist metadata (name + thumbnailId) from playlists.json.
  const playlists = await fetchJson('/playlists.json');
  const meta = playlists && playlists[playlistId];

  // Resolve the ordered video list to derive the resume point.
  const videos = await fetchJson(`/videos/${encodeURIComponent(playlistId)}.json`);
  const completedSet = new Set(completedVideoIds);
  const resumeVideoId = videos
    ? deriveResumeVideoId(videos, completedSet)
    : null;

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

  // salasel.app is a SPA — progress can change as the user navigates/marks
  // videos complete. Re-sync on history navigation and when the tab regains
  // focus, debounced so rapid changes coalesce.
  let timer = null;
  const scheduleSync = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      syncContinueWatching();
    }, 1000);
  };

  window.addEventListener('popstate', scheduleSync);
  window.addEventListener('pageshow', scheduleSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync();
  });
})();
