/**
 * storage.js — single source of truth for storage keys, defaults, and helpers.
 * Included by both the content script and the popup (via manifest content_scripts
 * ordering and popup.html script tags). All six keys default to false (OFF).
 */

/** @type {Record<string, string>} */
const STORAGE_KEYS = {
  recommendationSidebar: 'hideRecommendationSidebar',
  upNextAutoplay:        'hideUpNextAutoplay',
  endScreenCards:        'hideEndScreenCards',
  shortsShelf:           'hideShortsShelf',
  comments:              'hideComments',
  homepageFeed:          'hideHomepageFeed',
  language:              'language',
};

/**
 * Key in chrome.storage.local holding the single "most recent" continue-watching
 * record bridged from salasel.app. Shape:
 *   { version: 1, kind, contentId, mediaId, playlistId?, playlistName?, title,
 *     thumbnailId?, destination: 'https://salasel.app/...', playedAt }
 * Kept in `local` (not `sync`) because it is device-local browsing state, not a
 * user preference, and may update frequently.
 */
const CONTINUE_WATCHING_KEY = 'continueWatching';
const ACTIVITY_VERSION = 1;
const ACTIVITY_MAX_FUTURE_MS = 5 * 60 * 1000;
const SALASEL_ORIGIN = 'https://salasel.app';
const ACTIVITY_LOCALES = new Set(['ar', 'en', 'ja']);
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const PODCAST_ID_PATTERN = /^pod_[A-Za-z0-9_-]+$/;
const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Key in chrome.storage.local holding the per-video notes store — a map keyed by
 * YouTube video id. Kept in `local` (device-local, may update frequently) and
 * separate from CONTINUE_WATCHING_KEY.
 *
 * Note_Record shape (single source of truth for the extension↔web-app contract):
 *   {
 *     videoId:    string,          // YouTube ?v= id
 *     playlistId: string | null,   // YouTube ?list= id when taken in a playlist
 *     text:       string,          // plain-text note body (may contain newlines)
 *     updatedAt:  number           // epoch ms of last edit
 *   }
 *
 * Notes_Store shape: { [videoId: string]: Note_Record }
 */
const NOTES_KEY = 'salaselNotes';

/** Schema version for the notes handoff payload delivered to salasel.app. */
const NOTES_HANDOFF_VERSION = 1;

/** localStorage key + event name used to hand notes to the Salasel web app. */
const NOTES_INBOX_KEY   = 'salasel-notes-inbox';
const NOTES_UPDATED_EVT = 'salasel:notes-updated';

/**
 * localStorage key + event name the Salasel web app uses to push notes back to
 * the extension (app→extension). The mirror of the inbox channel: same payload
 * schema, opposite direction. The native `storage` event does not fire in the
 * writing tab, so consumers rely on the CustomEvent to re-read.
 */
const NOTES_OUTBOX_KEY      = 'salasel-notes-outbox';
const APP_NOTES_UPDATED_EVT = 'salasel:app-notes-updated';

/** Hard cap on a single note's length (characters). */
const NOTE_MAX_LENGTH = 100000;

/**
 * Boolean toggle keys only (the distraction elements). Kept separate from the
 * non-boolean `language` preference so iteration over toggles stays clean.
 * @type {Record<string, boolean>}
 */
const TOGGLE_DEFAULTS = {
  hideRecommendationSidebar: false,
  hideUpNextAutoplay:        false,
  hideEndScreenCards:        false,
  hideShortsShelf:           false,
  hideComments:              false,
  hideHomepageFeed:          false,
};

/**
 * All default values. Toggles default OFF; UI language defaults to Arabic.
 *
 * `notesPanelSide` is the side of the screen the notes panel docks to —
 * `'right'` (default) or `'left'`. It's a synced UI preference (not a
 * distraction toggle) so it isn't part of TOGGLE_DEFAULTS and doesn't affect the
 * popup's "hidden" badge count.
 * @type {Record<string, boolean|string>}
 */
const DEFAULTS = {
  ...TOGGLE_DEFAULTS,
  language: 'ar',
  notesPanelSide: 'right',
};

/**
 * Read all preferences, filling any missing keys with their defaults.
 * @returns {Promise<Record<string, boolean>>}
 */
function getPrefs() {
  return chrome.storage.sync.get(DEFAULTS);
}

/**
 * Persist a single preference key without touching others.
 * @param {string} key   — one of the keys in DEFAULTS
 * @param {boolean} value
 * @returns {Promise<void>}
 */
function setPref(key, value) {
  return chrome.storage.sync.set({ [key]: value });
}

/** True for a non-empty display string. */
function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Returns a canonical relative route only when every identity matches its kind. */
function getActivityRoute(record) {
  if (!record || typeof record !== 'object' || !YOUTUBE_ID_PATTERN.test(record.mediaId || '')) return null;
  if (record.kind === 'podcast' && PODCAST_ID_PATTERN.test(record.contentId || '')) return `/podcast/${record.contentId}/watch`;
  if (record.kind === 'video' && record.contentId === record.mediaId) return `/video/${record.mediaId}`;
  if (record.kind === 'playlist-video' && record.contentId === record.mediaId && PLAYLIST_ID_PATTERN.test(record.playlistId || '')) return `/playlist/${record.playlistId}/${record.mediaId}`;
  return null;
}

/** Accept old podcast links exactly; normalize them to the current playback route. */
function matchesActivityRoute(record, path, route) {
  return path === route || (record.kind === 'podcast' && path === `/podcast/${record.contentId}`);
}

/**
 * Validates app activity and creates the only URL the extension will open.
 * `playedAt` remains the source playback time, never the bridge receipt time.
 */
function createContinueWatchingRecord(activity, now = Date.now()) {
  if (!activity || typeof activity !== 'object' || activity.version !== ACTIVITY_VERSION ||
      !['podcast', 'video', 'playlist-video'].includes(activity.kind) ||
      !hasText(activity.contentId) || !hasText(activity.mediaId) || !hasText(activity.title) ||
      typeof activity.playedAt !== 'number' || !Number.isFinite(activity.playedAt) || activity.playedAt < 0 ||
      activity.playedAt > now + ACTIVITY_MAX_FUTURE_MS ||
      (activity.thumbnailId !== undefined && (!hasText(activity.thumbnailId) || !YOUTUBE_ID_PATTERN.test(activity.thumbnailId)))) return null;

  const route = getActivityRoute(activity);
  const destination = activity.destination;
  if (!route || typeof destination !== 'string') return null;
  const locale = destination.split('/')[1];
  if (!ACTIVITY_LOCALES.has(locale) || !matchesActivityRoute(activity, destination.slice(locale.length + 1), route)) return null;

  return {
    version: ACTIVITY_VERSION,
    kind: activity.kind,
    contentId: activity.contentId,
    mediaId: activity.mediaId,
    playlistId: activity.playlistId,
    playlistName: hasText(activity.playlistName) ? activity.playlistName.trim() : undefined,
    title: activity.title.trim(),
    thumbnailId: activity.thumbnailId,
    destination: `${SALASEL_ORIGIN}/${locale}${route}`,
    playedAt: activity.playedAt,
  };
}

/** Converts an old extension record only when it carries exact safe identities. */
function migrateLegacyContinueWatching(record, now = Date.now()) {
  if (!record || typeof record !== 'object' || !PLAYLIST_ID_PATTERN.test(record.playlistId || '') ||
      !YOUTUBE_ID_PATTERN.test(record.resumeVideoId || '') ||
      (record.thumbnailId !== undefined && !YOUTUBE_ID_PATTERN.test(record.thumbnailId || '')) ||
      !Number.isFinite(record.updatedAt) || record.updatedAt < 0 || record.updatedAt > now + ACTIVITY_MAX_FUTURE_MS) return null;
  const playedAt = record.updatedAt;
  const title = hasText(record.playlistName) ? record.playlistName.trim() : 'Salasel playlist';
  return {
    version: ACTIVITY_VERSION,
    kind: 'playlist-video',
    contentId: record.resumeVideoId,
    mediaId: record.resumeVideoId,
    playlistId: record.playlistId,
    playlistName: hasText(record.playlistName) ? record.playlistName.trim() : undefined,
    title,
    thumbnailId: YOUTUBE_ID_PATTERN.test(record.thumbnailId || '') ? record.thumbnailId : record.resumeVideoId,
    destination: `${SALASEL_ORIGIN}/ar/playlist/${record.playlistId}/${record.resumeVideoId}`,
    playedAt,
  };
}

/** Validates storage before rendering; legacy data becomes a safe app destination. */
function normalizeContinueWatching(record, now = Date.now()) {
  if (!record || typeof record !== 'object') return null;
  if (record.version !== ACTIVITY_VERSION) {
    return Object.prototype.hasOwnProperty.call(record, 'version') ? null : migrateLegacyContinueWatching(record, now);
  }
  if (!['podcast', 'video', 'playlist-video'].includes(record.kind) ||
      !hasText(record.contentId) || !hasText(record.mediaId) || !hasText(record.title) ||
      typeof record.playedAt !== 'number' || !Number.isFinite(record.playedAt) || record.playedAt < 0 ||
      record.playedAt > now + ACTIVITY_MAX_FUTURE_MS ||
      (record.thumbnailId !== undefined && (!hasText(record.thumbnailId) || !YOUTUBE_ID_PATTERN.test(record.thumbnailId)))) return null;
  const route = getActivityRoute(record);
  if (!route || typeof record.destination !== 'string') return null;
  const match = record.destination.match(/^https:\/\/salasel\.app\/(ar|en|ja)(\/.*)$/);
  if (!match || !matchesActivityRoute(record, match[2], route)) return null;
  return {
    version: ACTIVITY_VERSION,
    kind: record.kind,
    contentId: record.contentId,
    mediaId: record.mediaId,
    playlistId: record.playlistId,
    playlistName: hasText(record.playlistName) ? record.playlistName.trim() : undefined,
    title: record.title.trim(),
    thumbnailId: record.thumbnailId,
    destination: `${SALASEL_ORIGIN}/${match[1]}${route}`,
    playedAt: record.playedAt,
  };
}

/** Read validated continue-watching data, never arbitrary local storage values. */
async function getContinueWatching() {
  const out = await chrome.storage.local.get(CONTINUE_WATCHING_KEY);
  return normalizeContinueWatching(out[CONTINUE_WATCHING_KEY]);
}

/** Persist only a validated, trusted continue-watching record. */
async function setContinueWatching(record) {
  const normalized = normalizeContinueWatching(record);
  if (!normalized) throw new Error('Invalid continue-watching record');
  await chrome.storage.local.set({ [CONTINUE_WATCHING_KEY]: normalized });
}

/** Newer source activity wins; equal timestamps preserve the first record. */
async function mergeContinueWatching(record) {
  const candidate = normalizeContinueWatching(record);
  if (!candidate) return null;
  const existing = await getContinueWatching();
  if (existing && candidate.playedAt <= existing.playedAt) return existing;
  await setContinueWatching(candidate);
  return candidate;
}

/** Sends writes through the single MV3 worker authority when one is available. */
async function updateContinueWatching(record) {
  const candidate = normalizeContinueWatching(record);
  if (!candidate) return null;
  if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'salasel:continue-watching:update', record: candidate });
      return normalizeContinueWatching(response && response.record);
    } catch (_err) {
      return null;
    }
  }
  return mergeContinueWatching(candidate);
}

/**
 * Read the entire Notes_Store from chrome.storage.local.
 * Resolves to the map object (possibly empty), never null.
 * @returns {Promise<Record<string, object>>}
 */
async function getNotesStore() {
  const out = await chrome.storage.local.get(NOTES_KEY);
  const store = out[NOTES_KEY];
  return store && typeof store === 'object' ? store : {};
}

/**
 * Read the Note_Record for a single video id.
 * @param {string} videoId
 * @returns {Promise<object|null>}
 */
async function getNote(videoId) {
  if (!videoId) return null;
  const store = await getNotesStore();
  return store[videoId] || null;
}

/**
 * Write (upsert) a Note_Record for a single video id without touching other
 * records. Empty/whitespace-only text removes the record instead (see deleteNote).
 * @param {string} videoId
 * @param {string} text
 * @param {string|null} [playlistId]
 * @returns {Promise<object|null>} the stored record, or null if it was removed
 */
async function setNote(videoId, text, playlistId) {
  if (!videoId) return null;

  const trimmed = typeof text === 'string' ? text : '';
  if (trimmed.trim() === '') {
    await deleteNote(videoId);
    return null;
  }

  const store = await getNotesStore();
  const record = {
    videoId,
    playlistId: playlistId || null,
    text: trimmed.slice(0, NOTE_MAX_LENGTH),
    updatedAt: Date.now(),
  };
  store[videoId] = record;
  await chrome.storage.local.set({ [NOTES_KEY]: store });
  return record;
}

/**
 * Remove the Note_Record for a video id. No-op when absent.
 * @param {string} videoId
 * @returns {Promise<void>}
 */
async function deleteNote(videoId) {
  if (!videoId) return;
  const store = await getNotesStore();
  if (!(videoId in store)) return;
  delete store[videoId];
  await chrome.storage.local.set({ [NOTES_KEY]: store });
}

/**
 * Build the full handoff payload (envelope + all non-empty notes) that the
 * Salasel web app reads. Excludes records whose text is empty.
 * @param {Record<string, object>} store
 * @returns {object}
 */
function buildNotesHandoffPayload(store) {
  const notes = {};
  for (const [videoId, rec] of Object.entries(store || {})) {
    if (rec && typeof rec.text === 'string' && rec.text.trim() !== '') {
      notes[videoId] = rec;
    }
  }
  return {
    source: 'salasel-extension',
    version: NOTES_HANDOFF_VERSION,
    exportedAt: Date.now(),
    notes,
  };
}

/**
 * Loosely validate + normalize a single incoming Note_Record from a handoff
 * payload. Requires string `videoId` and string `text`; coerces a missing/
 * non-string `playlistId` to null and a non-finite `updatedAt` to 0. Returns
 * null when the record can't be salvaged.
 * @param {any} rec
 * @returns {{videoId:string, playlistId:string|null, text:string, updatedAt:number}|null}
 */
function normalizeIncomingNote(rec) {
  if (!rec || typeof rec !== 'object') return null;
  if (typeof rec.videoId !== 'string' || rec.videoId === '') return null;
  if (typeof rec.text !== 'string') return null;

  const playlistId = typeof rec.playlistId === 'string' ? rec.playlistId : null;
  const updatedAt = Number.isFinite(rec.updatedAt) ? rec.updatedAt : 0;

  return {
    videoId: rec.videoId,
    playlistId,
    text: rec.text.slice(0, NOTE_MAX_LENGTH),
    updatedAt,
  };
}

/**
 * Validate a full notes handoff payload (the envelope written to the inbox/
 * outbox) and return its normalized notes as a { [videoId]: Note_Record } map.
 * Rejects (returns null) unless `source === 'salasel-extension'` and
 * `version === NOTES_HANDOFF_VERSION`. Malformed individual records are skipped.
 * @param {any} payload
 * @returns {Record<string, object>|null}
 */
function extractHandoffNotes(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.source !== 'salasel-extension') return null;
  if (payload.version !== NOTES_HANDOFF_VERSION) return null;
  if (!payload.notes || typeof payload.notes !== 'object') return null;

  const out = {};
  for (const rec of Object.values(payload.notes)) {
    const norm = normalizeIncomingNote(rec);
    if (norm) out[norm.videoId] = norm;
  }
  return out;
}

/**
 * Merge incoming notes into the extension's Notes_Store using last-write-wins on
 * `updatedAt`: an incoming note only overwrites an existing one when its
 * `updatedAt` is strictly greater. Notes absent from `incoming` are left
 * untouched — this never deletes. Persists only when something actually changed.
 * @param {Record<string, object>} incoming — normalized { [videoId]: Note_Record }
 * @returns {Promise<boolean>} true if the store was modified + written
 */
async function mergeIncomingNotes(incoming) {
  if (!incoming || typeof incoming !== 'object') return false;

  let store;
  try {
    store = await getNotesStore();
  } catch (_err) {
    return false;
  }

  let changed = false;
  for (const [videoId, rec] of Object.entries(incoming)) {
    const existing = store[videoId];
    if (!existing || rec.updatedAt > (existing.updatedAt || 0)) {
      store[videoId] = rec;
      changed = true;
    }
  }

  if (!changed) return false;

  try {
    await chrome.storage.local.set({ [NOTES_KEY]: store });
  } catch (_err) {
    return false;
  }
  return true;
}
