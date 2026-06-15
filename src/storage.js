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
};

/**
 * Default values — all OFF (false = element visible).
 * New keys added in future versions will also need a default here.
 * @type {Record<string, boolean>}
 */
const DEFAULTS = {
  hideRecommendationSidebar: false,
  hideUpNextAutoplay:        false,
  hideEndScreenCards:        false,
  hideShortsShelf:           false,
  hideComments:              false,
  hideHomepageFeed:          false,
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
