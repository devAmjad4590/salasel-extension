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

const STYLE_ID      = 'salasel-hide';
const EMPTY_HOME_ID = 'salasel-empty-home';
const HOME_FEED_KEY = 'hideHomepageFeed';

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

/** True when the current URL is the YouTube homepage. */
function isHomepage() {
  return (
    location.hostname === 'www.youtube.com' &&
    (location.pathname === '/' || location.pathname === '')
  );
}

/**
 * Build the placeholder element with all styles inlined so they survive
 * injection into YouTube's DOM without needing an external stylesheet.
 * @param {string} lang — UI language for the placeholder text
 * @returns {HTMLElement}
 */
function buildPlaceholder(lang) {
  const el = document.createElement('div');
  el.id = EMPTY_HOME_ID;
  el.dir = isRTL(lang) ? 'rtl' : 'ltr';

  // All styles are inlined — no external fetch, no style-stripping issues.
  el.innerHTML = `
    <style>
      #salasel-empty-home {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 70vh;
        padding: 48px 24px;
        text-align: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        user-select: none;
      }
      #salasel-empty-home .salasel-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(255, 68, 68, 0.1);
        border: 1px solid rgba(255, 68, 68, 0.25);
        border-radius: 999px;
        padding: 4px 12px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #ff4444;
        margin-bottom: 24px;
      }
      #salasel-empty-home .salasel-badge-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #ff4444;
        flex-shrink: 0;
      }
      #salasel-empty-home .salasel-title {
        font-size: 22px;
        font-weight: 700;
        color: #e8e8e8;
        margin: 0 0 10px;
        letter-spacing: -0.01em;
      }
      #salasel-empty-home .salasel-subtitle {
        font-size: 14px;
        line-height: 1.7;
        max-width: 340px;
        color: #888;
        margin: 0;
      }
      #salasel-empty-home .salasel-hint {
        margin-top: 28px;
        font-size: 12px;
        color: #555;
      }
      #salasel-empty-home .salasel-hint kbd {
        display: inline-block;
        background: #1e1e1e;
        border: 1px solid #333;
        border-radius: 4px;
        padding: 2px 7px;
        font-family: inherit;
        font-size: 12px;
        color: #888;
      }
    </style>
    <div class="salasel-badge">
      <span class="salasel-badge-dot" aria-hidden="true"></span>
      ${t(lang, 'phBadge')}
    </div>
    <p class="salasel-title">${t(lang, 'phTitle')}</p>
    <p class="salasel-subtitle">${t(lang, 'phSubtitle')}</p>
    <p class="salasel-hint">${t(lang, 'phHint')}</p>
  `;

  return el;
}

/**
 * Semaphore — prevents multiple concurrent injection attempts racing each other.
 * Set to true while an injection is in flight; cleared when done or aborted.
 */
let homepageInjecting = false;

/**
 * If hideHomepageFeed is on and we're on the homepage, inject the placeholder.
 * If off or not on homepage, remove any existing placeholder.
 * @param {Record<string, boolean>} prefs
 */
async function applyHomepage(prefs) {
  if (!isHomepage() || !prefs[HOME_FEED_KEY]) {
    removeEmptyHome();
    return;
  }

  // Already injected — nothing to do.
  if (document.getElementById(EMPTY_HOME_ID)) return;

  // Another call is already in-flight — let it finish.
  if (homepageInjecting) return;
  homepageInjecting = true;

  try {
    // Wait for the feed container to appear (may not exist at document_start).
    const container = await waitForElement(
      'ytd-browse[page-subtype="home"] ytd-rich-grid-renderer',
      5000
    );

    // Bail out if conditions changed while we were waiting.
    if (!container || !prefs[HOME_FEED_KEY] || !isHomepage()) return;

    // Final guard: check again right before inserting.
    if (document.getElementById(EMPTY_HOME_ID)) return;

    container.style.display = 'none';
    container.parentNode.insertBefore(
      buildPlaceholder(currentPrefs.language || I18N_DEFAULT_LANG),
      container
    );
  } finally {
    homepageInjecting = false;
  }
}

/** Remove any existing placeholder and restore the feed grid. */
function removeEmptyHome() {
  const existing = document.getElementById(EMPTY_HOME_ID);
  if (existing) existing.remove();

  const grid = document.querySelector(
    'ytd-browse[page-subtype="home"] ytd-rich-grid-renderer'
  );
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
  ensureStyleEl().textContent = buildStyleText(prefs);
  applyHomepage(prefs); // intentionally not awaited — fire-and-forget
}

// ─── MutationObserver (SPA navigation guard) ──────────────────────────────────

let rafPending = false;

/**
 * Debounced via requestAnimationFrame. Re-asserts the style tag and re-evaluates
 * the homepage condition on SPA navigation, but does no broad DOM scanning.
 */
function onMutation() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;

    // Re-insert the style tag if YouTube removed it.
    if (!document.getElementById(STYLE_ID)) {
      ensureStyleEl().textContent = buildStyleText(currentPrefs);
    }

    // Re-evaluate homepage state (handles SPA navigation to/from homepage).
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
 * Resolves with the element once it exists, or null after timeoutMs.
 * @param {string} selector
 * @param {number} timeoutMs
 * @returns {Promise<Element|null>}
 */
function waitForElement(selector, timeoutMs) {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) { resolve(existing); return; }

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

  const relevant = Object.keys(changes).some((k) => k in DEFAULTS);
  if (!relevant) return;

  const updatedPrefs = { ...currentPrefs };
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key in DEFAULTS) updatedPrefs[key] = newValue;
  }

  // If the language changed, drop any existing placeholder so it rebuilds
  // in the new language on the next applyHomepage call.
  if (changes.language) removeEmptyHome();

  applyPrefs(updatedPrefs);
});

// ─── Init ─────────────────────────────────────────────────────────────────────

(async function init() {
  try {
    const prefs = await getPrefs();
    applyPrefs(prefs);
  } catch (err) {
    console.error('[Salasel] Failed to load preferences on init:', err);
    applyPrefs(DEFAULTS);
  }
  startObserver();
})();
