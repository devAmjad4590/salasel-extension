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
const CARD_ID       = 'salasel-continue-card';
const THEME_COLOR   = '#2e4b2c';

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

// ─── Continue-watching card ───────────────────────────────────────────────────

/**
 * Build the YouTube watch URL the site uses for outbound links.
 * @param {string} videoId
 * @param {string} playlistId
 * @returns {string}
 */
function buildWatchUrl(videoId, playlistId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` +
         `&list=${encodeURIComponent(playlistId)}`;
}

/**
 * Build the continue-watching card element from a stored record.
 * Styles are fully inlined so they survive injection into YouTube's DOM.
 * @param {object} record
 * @param {string} lang
 * @returns {HTMLElement}
 */
function buildContinueCard(record, lang) {
  const rtl  = isRTL(lang);
  const href = buildWatchUrl(record.resumeVideoId, record.playlistId);
  const thumbId = record.thumbnailId || record.resumeVideoId;
  const primaryThumb  = `https://img.youtube.com/vi/${thumbId}/sddefault.jpg`;
  const fallbackThumb = `https://i.ytimg.com/vi/${thumbId}/hqdefault.jpg`;

  const card = document.createElement('div');
  card.id  = CARD_ID;
  card.dir = rtl ? 'rtl' : 'ltr';

  card.innerHTML = `
    <style>
      #${CARD_ID} {
        position: relative;
        display: flex;
        align-items: center;
        gap: 16px;
        width: 100%;
        max-width: 920px;
        margin: 16px auto 24px;
        padding: 14px 16px;
        background: linear-gradient(135deg, ${THEME_COLOR} 0%, #233a21 100%);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 14px;
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #f1f5f0;
      }
      #${CARD_ID} .salasel-cw-thumb {
        width: 132px;
        height: 74px;
        border-radius: 9px;
        object-fit: cover;
        background: #1a2a19;
        flex-shrink: 0;
      }
      #${CARD_ID} .salasel-cw-body {
        flex: 1;
        min-width: 0;
      }
      #${CARD_ID} .salasel-cw-eyebrow {
        display: inline-block;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #b7d3b3;
        margin: 0 0 4px;
      }
      #${CARD_ID} .salasel-cw-heading {
        font-size: 13px;
        color: #cfe3cc;
        margin: 0 0 3px;
        font-weight: 500;
      }
      #${CARD_ID} .salasel-cw-name {
        font-size: 17px;
        font-weight: 700;
        line-height: 1.3;
        margin: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
      #${CARD_ID} .salasel-cw-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
      #${CARD_ID} .salasel-cw-continue {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        background: #f1f5f0;
        color: ${THEME_COLOR};
        font-size: 14px;
        font-weight: 700;
        text-decoration: none;
        padding: 9px 18px;
        border-radius: 999px;
        transition: transform 0.12s ease, background 0.12s ease;
        white-space: nowrap;
      }
      #${CARD_ID} .salasel-cw-continue:hover {
        background: #ffffff;
        transform: translateY(-1px);
      }
      #${CARD_ID} .salasel-cw-dismiss {
        background: transparent;
        border: none;
        color: #b7d3b3;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        padding: 8px 10px;
        border-radius: 999px;
        font-family: inherit;
      }
      #${CARD_ID} .salasel-cw-dismiss:hover { color: #f1f5f0; }
    </style>
    <img class="salasel-cw-thumb" alt=""
         src="${primaryThumb}"
         data-fallback="${fallbackThumb}" />
    <div class="salasel-cw-body">
      <span class="salasel-cw-eyebrow">${t(lang, 'cwEyebrow')}</span>
      <p class="salasel-cw-heading">${t(lang, 'cwHeading')}</p>
      <p class="salasel-cw-name" dir="auto"></p>
    </div>
    <div class="salasel-cw-actions">
      <a class="salasel-cw-continue" href="${href}">
        ${t(lang, 'cwContinue')}
      </a>
      <button type="button" class="salasel-cw-dismiss">${t(lang, 'cwDismiss')}</button>
    </div>
  `;

  // Set playlist name as text (avoids HTML injection from playlist titles).
  // Only show a real, human-readable name — never fall back to the raw playlist
  // id, which is meaningless to the user. If there's no name, hide the line.
  const nameEl = card.querySelector('.salasel-cw-name');
  if (nameEl) {
    const name = (record.playlistName || '').trim();
    if (name) {
      nameEl.textContent = name;
    } else {
      nameEl.remove();
    }
  }

  // Thumbnail fallback: sddefault → hqdefault.
  const img = card.querySelector('.salasel-cw-thumb');
  if (img) {
    img.addEventListener('error', function onErr() {
      img.removeEventListener('error', onErr);
      img.src = img.dataset.fallback;
    });
  }

  // Dismiss hides the card for this page view only (re-appears on next home load).
  const dismissBtn = card.querySelector('.salasel-cw-dismiss');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      cardDismissed = true;
      card.remove();
    });
  }

  return card;
}

/** True once the user dismisses the card, until the next homepage (re)load. */
let cardDismissed = false;

/** Guards against concurrent card injections racing each other. */
let cardInjecting = false;

/**
 * Inject the continue-watching card on the YouTube homepage when a stored record
 * exists. Removes the card when not on the homepage. Empty state (no record) =
 * no card, no error.
 */
async function applyContinueCard() {
  if (!isHomepage() || cardDismissed) {
    removeContinueCard();
    return;
  }
  if (document.getElementById(CARD_ID)) return;
  if (cardInjecting) return;
  cardInjecting = true;

  try {
    let record;
    try {
      record = await getContinueWatching();
    } catch (_err) {
      record = null;
    }
    // Empty state: nothing stored → show nothing extra.
    if (!record || !record.resumeVideoId || !record.playlistId) return;

    // When the homepage-feed toggle is on, the placeholder is the natural home
    // for the card (they group together, centered). Wait for whichever target
    // applies so we don't race the placeholder injection and strand the card.
    const feedHidden = currentPrefs[HOME_FEED_KEY];
    const target = feedHidden
      ? await waitForElement(`#${EMPTY_HOME_ID}`, 5000)
      : await waitForElement(
          'ytd-browse[page-subtype="home"] ytd-rich-grid-renderer',
          5000
        );
    if (!target || !isHomepage() || cardDismissed) return;
    if (document.getElementById(CARD_ID)) return;

    const card = buildContinueCard(
      record,
      currentPrefs.language || I18N_DEFAULT_LANG
    );

    // Placeholder showing → place the card inside it so card + "feed is off"
    // message sit together as one centered group. Otherwise insert above the grid.
    if (feedHidden && target.id === EMPTY_HOME_ID) {
      target.appendChild(card);
    } else {
      target.parentNode.insertBefore(card, target);
    }
  } finally {
    cardInjecting = false;
  }
}

/** Remove the continue-watching card if present. */
function removeContinueCard() {
  const existing = document.getElementById(CARD_ID);
  if (existing) existing.remove();
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
  applyHomepage(prefs);       // intentionally not awaited — fire-and-forget
  applyContinueCard();        // fire-and-forget
}

// ─── MutationObserver (SPA navigation guard) ──────────────────────────────────

let rafPending = false;

/** Last seen pathname, used to detect SPA navigation between routes. */
let lastPath = location.pathname;

/**
 * Debounced via requestAnimationFrame. Re-asserts the style tag and re-evaluates
 * the homepage condition on SPA navigation, but does no broad DOM scanning.
 */
function onMutation(mutations) {
  // Detect SPA route change: navigating back to the homepage should re-show a
  // previously dismissed card.
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    if (isHomepage()) cardDismissed = false;
  }

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

    // Re-evaluate the continue-watching card across navigation.
    applyContinueCard();
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
  // Continue-watching record lives in local storage — refresh the card when it
  // changes (e.g. the user just visited salasel.app in another tab).
  if (area === 'local') {
    if (changes[CONTINUE_WATCHING_KEY]) {
      cardDismissed = false;
      removeContinueCard();
      applyContinueCard();
    }
    return;
  }

  if (area !== 'sync') return;

  const relevant = Object.keys(changes).some((k) => k in DEFAULTS);
  if (!relevant) return;

  const updatedPrefs = { ...currentPrefs };
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key in DEFAULTS) updatedPrefs[key] = newValue;
  }

  // If the language changed, drop any existing placeholder + card so they
  // rebuild in the new language on the next apply pass.
  if (changes.language) {
    removeEmptyHome();
    removeContinueCard();
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
    applyPrefs(DEFAULTS);
  }
  startObserver();
})();
