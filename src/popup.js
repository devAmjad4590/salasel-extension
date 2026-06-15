/**
 * popup.js — reads preferences from chrome.storage.sync, renders toggle state
 * and the UI language, and writes individual key changes back on interaction.
 *
 * Depends on storage.js (getPrefs, setPref, DEFAULTS, TOGGLE_DEFAULTS) and
 * i18n.js (t, isRTL, I18N_DEFAULT_LANG) being loaded first.
 */

'use strict';

/** Current UI language for the popup session. */
let lang = I18N_DEFAULT_LANG;

/** Apply <html> lang/dir and translate every [data-i18n] element. */
function applyLanguage(prefs) {
  lang = prefs.language || I18N_DEFAULT_LANG;

  document.documentElement.lang = lang;
  document.documentElement.dir  = isRTL(lang) ? 'rtl' : 'ltr';

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(lang, el.dataset.i18n);
  });

  // Sync the select dropdown to the current language.
  const select = document.getElementById('lang-select');
  if (select) select.value = lang;

  updateBadge(prefs);
}

/** Update the header status badge with a count of active (ON) toggles. */
function updateBadge(prefs) {
  const badge = document.getElementById('status-badge');
  if (!badge) return;

  const total   = Object.keys(TOGGLE_DEFAULTS).length;
  const onCount = Object.keys(TOGGLE_DEFAULTS)
    .filter((key) => prefs[key] === true).length;

  badge.textContent = onCount === 0
    ? t(lang, 'statusAllOff')
    : t(lang, 'statusHidden', { n: onCount, total });
}

/** Collect the current toggle states from the DOM into a prefs-like object. */
function readToggleStates() {
  const state = { language: lang };
  document.querySelectorAll('#toggle-list input[data-key]').forEach((el) => {
    state[el.dataset.key] = el.checked;
  });
  return state;
}

/** Set all toggle inputs to match the given prefs object. */
function renderToggles(prefs) {
  document.querySelectorAll('#toggle-list input[data-key]').forEach((input) => {
    input.checked = prefs[input.dataset.key] === true;
  });
  updateBadge(prefs);
}

/** Attach change listeners to toggles — each writes only its own key. */
function bindToggles() {
  document.querySelectorAll('#toggle-list input[data-key]').forEach((input) => {
    input.addEventListener('change', () => {
      const key   = input.dataset.key;
      const value = input.checked;

      setPref(key, value).catch((err) => {
        console.error('[Salasel] Failed to save preference:', key, err);
        input.checked = !value; // revert on failure
      });

      updateBadge(readToggleStates());
    });
  });
}

/** Attach click listeners to the language switcher buttons. */
function bindLanguageSwitch() {
  const select = document.getElementById('lang-select');
  if (!select) return;

  select.addEventListener('change', () => {
    const next = select.value;
    if (next === lang) return;

    // Update lang before calling applyLanguage so readToggleStates()
    // picks up the new language value and applyLanguage translates correctly.
    lang = next;

    setPref('language', next).catch((err) => {
      console.error('[Salasel] Failed to save language:', err);
    });

    applyLanguage({ ...readToggleStates(), language: next });
  });
}

/** Entry point — load prefs, render language + toggles, then wire listeners. */
async function init() {
  let prefs;
  try {
    prefs = await getPrefs();
  } catch (err) {
    console.error('[Salasel] Failed to load preferences:', err);
    prefs = { ...DEFAULTS };
  }

  applyLanguage(prefs);
  renderToggles(prefs);
  bindToggles();
  bindLanguageSwitch();
}

document.addEventListener('DOMContentLoaded', init);
