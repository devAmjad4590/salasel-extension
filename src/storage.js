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
