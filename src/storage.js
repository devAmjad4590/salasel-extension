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
 *   { playlistId, playlistName, thumbnailId, resumeVideoId,
 *     completedVideoIds: string[], updatedAt: number }
 * Kept in `local` (not `sync`) because it is device-local browsing state, not a
 * user preference, and may update frequently.
 */
const CONTINUE_WATCHING_KEY = 'continueWatching';

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

/**
 * Read the continue-watching record from chrome.storage.local.
 * Resolves to the stored record object, or null if none is set.
 * @returns {Promise<object|null>}
 */
async function getContinueWatching() {
  const out = await chrome.storage.local.get(CONTINUE_WATCHING_KEY);
  return out[CONTINUE_WATCHING_KEY] || null;
}

/**
 * Persist the continue-watching record to chrome.storage.local.
 * @param {object} record
 * @returns {Promise<void>}
 */
function setContinueWatching(record) {
  return chrome.storage.local.set({ [CONTINUE_WATCHING_KEY]: record });
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
