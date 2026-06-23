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
 * @type {Record<string, boolean|string>}
 */
const DEFAULTS = {
  ...TOGGLE_DEFAULTS,
  language: 'ar',
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
