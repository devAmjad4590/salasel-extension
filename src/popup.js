/**
 * popup.js — reads preferences from chrome.storage.sync, renders toggle state,
 * and writes individual key changes back on user interaction.
 *
 * Depends on storage.js being loaded first (provides getPrefs, setPref, DEFAULTS).
 */

'use strict';

/** Update the header status badge with a count of active (ON) toggles. */
function updateBadge(prefs) {
  const badge = document.getElementById('status-badge');
  if (!badge) return;
  const onCount = Object.values(prefs).filter(Boolean).length;
  const total   = Object.keys(DEFAULTS).length;
  badge.textContent = onCount === 0
    ? 'All visible'
    : `${onCount} / ${total} hidden`;
}

/** Set all toggle inputs to match the given prefs object. */
function renderToggles(prefs) {
  const inputs = document.querySelectorAll('#toggle-list input[data-key]');
  inputs.forEach((input) => {
    const key = input.dataset.key;
    input.checked = prefs[key] === true;
  });
  updateBadge(prefs);
}

/** Attach change listeners to all toggles. Each writes only its own key. */
function bindToggles() {
  const inputs = document.querySelectorAll('#toggle-list input[data-key]');
  inputs.forEach((input) => {
    input.addEventListener('change', () => {
      const key   = input.dataset.key;
      const value = input.checked;

      setPref(key, value).catch((err) => {
        // Revert the visual state if the write failed.
        console.error('[Salasel] Failed to save preference:', key, err);
        input.checked = !value;
      });

      // Update the badge immediately for responsiveness.
      const currentPrefs = {};
      document.querySelectorAll('#toggle-list input[data-key]').forEach((el) => {
        currentPrefs[el.dataset.key] = el.checked;
      });
      updateBadge(currentPrefs);
    });
  });
}

/** Entry point — load prefs, render, then wire up listeners. */
async function init() {
  try {
    const prefs = await getPrefs();
    renderToggles(prefs);
  } catch (err) {
    console.error('[Salasel] Failed to load preferences:', err);
    // Fall back to defaults so the UI isn't broken.
    renderToggles(DEFAULTS);
  }
  bindToggles();
}

document.addEventListener('DOMContentLoaded', init);
