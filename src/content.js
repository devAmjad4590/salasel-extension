/**
 * content.js — injected into every YouTube page at document_start.
 *
 * Responsibilities:
 *  1. Build and maintain a single managed <style id="salasel-hide"> whose
 *     contents reflect the user's current toggle preferences.
 *  2. Apply preferences immediately on load (before paint where possible).
 *  3. React to chrome.storage.onChanged so open tabs update without reload.
 *  4. Keep the style tag alive across YouTube's SPA navigation via MutationObserver.
 *  5. Replace the homepage feed with a clean empty placeholder when that toggle is on.
 *
 * Depends on storage.js and hide-rules.js being declared first in manifest.json
 * content_scripts (provides DEFAULTS, HIDE_RULES, getPrefs, setPref).
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const STYLE_ID        = 'salasel-hide';
const EMPTY_HOME_ID   = 'salasel-empty-home';
const HOME_FEED_KEY   = 'hideHomepageFeed';

/** URL of the web-accessible empty-home resource, resolved at runtime. */
const EMPTY_HOME_URL  = chrome.runtime.getURL('public/empty-home.html');

// ─── Style element helpers ────────────────────────────────────────────────────

/**
 * Find the managed <style> or create it. Appends to <head> if available,
 * falls back to <html> at document_start when <head> doesn't exist yet.
 * @returns {HTMLStyleElement}
 */
function ensureStyleEl() {
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    (document.head || document.documentElement).appendChild(el);
  }
  return el;
}

/**
 * Build a stylesheet string from the current prefs.
 * Only keys that are true AND exist in HIDE_RULES produce rules.
 * @param {Record<string, boolean>} prefs
 * @returns {string}
 */
function buildStyleText(prefs) {
  let css = '';
  for (const key of Object.keys(HIDE_RULES)) {
    if (prefs[key]) {
      css += HIDE_RULES[key]
        .map((sel) => `${sel}{display:none !important;}`)
        .join('');
    }
  }
  return css;
}

// ─── Homepage replacement ─────────────────────────────────────────────────────

/** True when the current URL is the YouTube homepage (no path beyond /). */
function isHomepage() {
  const { hostname, pathname } = location;
  return hostname === 'www.youtube.com' && (pathname === '/' || pathname === '');
}

/** Cache for the fetched empty-home HTML string so we only fetch it once. */
let emptyHomeHTML = null;

/**
 * Fetch the empty-home markup and cache it.
 * @returns {Promise<string>}
 */
async function fetchEmptyHomeHTML() {
  if (emptyHomeHTML !== null) return emptyHomeHTML;
  try {
    const res  = await fetch(EMPTY_HOME_URL);
    const text = await res.text();
    // Parse and extract just the #salasel-empty-home element.
    const doc  = new DOMParser().parseFromString(text, 'text/html');
    const node = doc.getElementById(EMPTY_HOME_ID);
    emptyHomeHTML = node ? node.outerHTML : '';
  } catch (err) {
    console.warn('[Salasel] Could not load empty-home.html:', err);
    emptyHomeHTML = '';
  }
  return emptyHomeHTML;
}

/**
 * If hideHomepageFeed is on and we're on the homepage, find the feed container
 * and replace its contents with the clean placeholder.
 * If off, or not on homepage, remove any existing placeholder.
 * @param {Record<string, boolean>} prefs
 */
async function applyHomepage(prefs) {
  if (!isHomepage()) {
    removeEmptyHome();
    return;
  }

  if (!prefs[HOME_FEED_KEY]) {
    removeEmptyHome();
    return;
  }

  // Already injected — nothing to do.
  if (document.getElementById(EMPTY_HOME_ID)) return;

  // Wait for the feed container to exist (it may not at document_start).
  const container = await waitForElement(
    'ytd-browse[page-subtype="home"] ytd-rich-grid-renderer',
    4000
  );
  if (!container) return; // Timed out — YouTube DOM not ready; MutationObserver will retry.

  // Double-check prefs haven't changed while we were waiting.
  if (!prefs[HOME_FEED_KEY] || !isHomepage()) return;

  const html = await fetchEmptyHomeHTML();
  if (!html) return;

  // Hide the real feed grid and inject the placeholder alongside it.
  container.style.display = 'none';
  const placeholder = document.createElement('div');
  placeholder.innerHTML = html;
  const placeholderNode = placeholder.firstElementChild;
  if (placeholderNode) {
    container.parentNode.insertBefore(placeholderNode, container);
  }
}

/** Remove any existing empty-home placeholder and restore the feed container. */
function removeEmptyHome() {
  const existing = document.getElementById(EMPTY_HOME_ID);
  if (existing) existing.remove();

  // Re-show the feed grid if it was hidden.
  const grid = document.querySelector('ytd-browse[page-subtype="home"] ytd-rich-grid-renderer');
  if (grid) grid.style.display = '';
}

// ─── Apply all prefs ──────────────────────────────────────────────────────────

/** In-memory snapshot of current prefs, kept up-to-date by onChanged. */
let currentPrefs = { ...DEFAULTS };

/**
 * Rebuild the managed stylesheet and re-evaluate the homepage state.
 * @param {Record<string, boolean>} prefs
 */
function applyPrefs(prefs) {
  currentPrefs = prefs;
  const styleEl = ensureStyleEl();
  styleEl.textContent = buildStyleText(prefs);
  applyHomepage(prefs); // async, but fire-and-forget is fine here
}

// ─── MutationObserver (SPA navigation guard) ──────────────────────────────────

let rafPending = false;

/**
 * Debounced via requestAnimationFrame so the observer doesn't thrash on rapid
 * DOM mutations. Only re-asserts the style tag presence and re-evaluates homepage.
 */
function onMutation() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;

    // Re-insert the style tag if YouTube removed it.
    if (!document.getElementById(STYLE_ID)) {
      applyPrefs(currentPrefs);
      return;
    }

    // Re-evaluate homepage state on every navigation tick.
    applyHomepage(currentPrefs);
  });
}

function startObserver() {
  const observer = new MutationObserver(onMutation);
  observer.observe(document.documentElement, {
    childList: true,
    subtree:   true,
  });
}

// ─── Utility: wait for an element to appear in the DOM ────────────────────────

/**
 * Poll for a CSS selector to appear, up to `timeoutMs` milliseconds.
 * @param {string}  selector
 * @param {number}  timeoutMs
 * @returns {Promise<Element|null>}
 */
function waitForElement(selector, timeoutMs) {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const deadline = Date.now() + timeoutMs;
    const poll = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        poll.disconnect();
        resolve(el);
      } else if (Date.now() > deadline) {
        poll.disconnect();
        resolve(null);
      }
    });
    poll.observe(document.documentElement, { childList: true, subtree: true });
  });
}

// ─── chrome.storage.onChanged ─────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;

  // Check if any of our keys changed.
  const relevant = Object.keys(changes).some((k) => k in DEFAULTS);
  if (!relevant) return;

  // Merge the changed values into the current prefs snapshot.
  const updatedPrefs = { ...currentPrefs };
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key in DEFAULTS) {
      updatedPrefs[key] = newValue;
    }
  }
  applyPrefs(updatedPrefs);
});

// ─── Init ─────────────────────────────────────────────────────────────────────

(async function init() {
  try {
    const prefs = await getPrefs();
    applyPrefs(prefs);
  } catch (err) {
    console.error('[Salasel] Failed to load preferences on init:', err);
    applyPrefs(DEFAULTS); // Fail safe: apply defaults (all OFF, nothing hidden)
  }

  startObserver();
})();
