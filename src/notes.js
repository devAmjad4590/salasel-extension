/**
 * notes.js — per-video note-taking on YouTube watch pages.
 *
 * Responsibilities:
 *  1. Inject a "notes" button into the YouTube player control bar and keep it
 *     alive across YouTube's SPA navigation.
 *  2. Toggle a compact, width-capped notes panel on the inline-end (right in LTR,
 *     left in RTL) side of the page.
 *  3. Detect the current video id from the URL and load/save its note.
 *  4. Autosave (debounced) to chrome.storage.local via the Storage_Module.
 *  5. Handle the fullscreen edge case: exit fullscreen before opening the panel.
 *  6. Export notes for the current video, or aggregated for the current playlist.
 *  7. Push the full notes snapshot to the Salasel web app handoff channel on change.
 *
 * Depends on storage.js (getNote, setNote, deleteNote, getNotesStore,
 * buildNotesHandoffPayload, NOTE_MAX_LENGTH, NOTES_INBOX_KEY, NOTES_UPDATED_EVT,
 * NOTES_KEY) and i18n.js (t, isRTL, I18N_DEFAULT_LANG). Declared after those in
 * manifest content_scripts.
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const NOTES_BTN_ID    = 'salasel-notes-btn';
const NOTES_PANEL_ID  = 'salasel-notes-panel';
const NOTES_TOAST_ID  = 'salasel-notes-toast';
const NOTES_THEME     = '#2e4b2c';
const CONTROLS_SEL     = '.ytp-right-controls';
const SAVE_DEBOUNCE_MS = 800;

// ─── State ──────────────────────────────────────────────────────────────────

/** UI language, refreshed from prefs. */
let notesLang = (typeof I18N_DEFAULT_LANG !== 'undefined') ? I18N_DEFAULT_LANG : 'ar';

/** Whether the panel is currently open. */
let panelOpen = false;

/** The video id the panel is currently bound to. */
let boundVideoId = null;

/** Pending debounced-save timer handle. */
let saveTimer = null;

// ─── URL parsing ──────────────────────────────────────────────────────────────

/** True on a YouTube watch page. */
function isWatchPage() {
  return location.pathname === '/watch';
}

/**
 * Parse the current video id from the URL. Returns null when absent/malformed.
 * @returns {string|null}
 */
function getCurrentVideoId() {
  if (!isWatchPage()) return null;
  const v = new URLSearchParams(location.search).get('v');
  // YouTube ids are 11 chars of [A-Za-z0-9_-]; be lenient but reject empty/space.
  if (!v || !/^[A-Za-z0-9_-]{6,}$/.test(v)) return null;
  return v;
}

/** Parse the current playlist id from the URL, or null. */
function getCurrentPlaylistId() {
  const list = new URLSearchParams(location.search).get('list');
  return list && list.trim() !== '' ? list : null;
}

// ─── Fullscreen ───────────────────────────────────────────────────────────────

/** True when any element is in the browser Fullscreen API state. */
function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

/**
 * Attempt to exit fullscreen. Resolves true if we left fullscreen, false if we
 * couldn't (caller then shows a prompt).
 * @returns {Promise<boolean>}
 */
async function tryExitFullscreen() {
  if (!isFullscreen()) return true;
  try {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (!exit) return false;
    await exit.call(document);
    // Give the layout a tick to settle after leaving fullscreen.
    await new Promise((r) => setTimeout(r, 60));
    return !isFullscreen();
  } catch (_err) {
    return false;
  }
}

// ─── Toast (transient messages) ───────────────────────────────────────────────

let toastTimer = null;

/** Show a short-lived message near the panel. */
function showToast(message) {
  let toast = document.getElementById(NOTES_TOAST_ID);
  if (!toast) {
    toast = document.createElement('div');
    toast.id = NOTES_TOAST_ID;
    toast.dir = isRTL(notesLang) ? 'rtl' : 'ltr';
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('salasel-notes-toast--show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('salasel-notes-toast--show');
  }, 2600);
}

// ─── Button injection ─────────────────────────────────────────────────────────

/**
 * SVG icon for the notes button. Flat monochrome white to match YouTube's own
 * control-bar icons. A note page (folded corner + text lines) whose bottom line
 * is drawn as two interlocking chain links — a nod to the Salasel ("chains")
 * brand — kept bold enough to read at ~24px.
 */
// Flat white line-art glyph, centered in a 24×24 box (page spans x5–19, y3–21 →
// centered on 12,12). Matches YouTube's native monochrome control icons.
const NOTES_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" ' +
  'stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
  'xmlns="http://www.w3.org/2000/svg">' +
    // Page with a folded top-right corner.
    '<path d="M6.5 3h7.5l5 5v11.5a1.5 1.5 0 0 1-1.5 1.5h-11a1.5 1.5 0 0 1-1.5-1.5V4.5A1.5 1.5 0 0 1 6.5 3z"/>' +
    '<path d="M14 3v5h5"/>' +
    // Top text line (short).
    '<path d="M8 10.5h4"/>' +
    // Bottom text line (long).
    '<path d="M8 17h8"/>' +
    // Middle "line" as two interlocking chain links (brand accent).
    '<rect x="8" y="12.2" width="5" height="3" rx="1.5"/>' +
    '<rect x="11" y="12.2" width="5" height="3" rx="1.5"/>' +
  '</svg>';

/**
 * Insert the notes button into the player control bar if not already present.
 * @returns {boolean} true if the button exists after the call
 */
function ensureButton() {
  if (!isWatchPage()) return false;
  if (document.getElementById(NOTES_BTN_ID)) return true;

  const controls = document.querySelector(CONTROLS_SEL);
  if (!controls) return false;

  const btn = document.createElement('button');
  btn.id = NOTES_BTN_ID;
  btn.className = 'ytp-button salasel-notes-btn';
  btn.title = t(notesLang, 'notesButton');
  btn.setAttribute('aria-label', t(notesLang, 'notesButton'));
  btn.innerHTML = NOTES_ICON_SVG;
  btn.addEventListener('click', onButtonClick);

  // Place at the start of the right-controls group so it sits with player buttons.
  controls.insertBefore(btn, controls.firstChild);
  return true;
}

/** Notes button click → toggle panel (handling fullscreen + no-video). */
async function onButtonClick(e) {
  e.preventDefault();
  e.stopPropagation();

  if (panelOpen) {
    closePanel();
    return;
  }

  const videoId = getCurrentVideoId();
  if (!videoId) {
    showToast(t(notesLang, 'notesNoVideo'));
    return;
  }

  if (isFullscreen()) {
    const exited = await tryExitFullscreen();
    if (!exited) {
      showToast(t(notesLang, 'notesExitFullscreen'));
      return;
    }
  }

  await openPanel(videoId);
}

// ─── Panel ────────────────────────────────────────────────────────────────────

/** Build the panel DOM (once). Returns the panel element. */
function buildPanel() {
  const rtl = isRTL(notesLang);
  const panel = document.createElement('div');
  panel.id = NOTES_PANEL_ID;
  panel.dir = rtl ? 'rtl' : 'ltr';

  panel.innerHTML = `
    <div class="salasel-np-header">
      <span class="salasel-np-title"></span>
      <span class="salasel-np-status" aria-live="polite"></span>
      <button type="button" class="salasel-np-close" aria-label=""></button>
    </div>
    <textarea class="salasel-np-text" spellcheck="true"></textarea>
    <div class="salasel-np-actions">
      <button type="button" class="salasel-np-dl-video"></button>
      <button type="button" class="salasel-np-dl-playlist"></button>
    </div>
  `;

  applyPanelLabels(panel);

  panel.querySelector('.salasel-np-close').addEventListener('click', closePanel);
  panel.querySelector('.salasel-np-dl-video')
       .addEventListener('click', downloadVideoNotes);
  panel.querySelector('.salasel-np-dl-playlist')
       .addEventListener('click', downloadPlaylistNotes);

  const textarea = panel.querySelector('.salasel-np-text');
  textarea.maxLength = NOTE_MAX_LENGTH;
  textarea.addEventListener('input', onTextInput);

  return panel;
}

/** (Re)apply localized labels + dir to an existing panel. */
function applyPanelLabels(panel) {
  const rtl = isRTL(notesLang);
  panel.dir = rtl ? 'rtl' : 'ltr';
  panel.querySelector('.salasel-np-title').textContent = t(notesLang, 'notesTitle');
  panel.querySelector('.salasel-np-close')
       .setAttribute('aria-label', t(notesLang, 'notesClose'));
  panel.querySelector('.salasel-np-close').textContent = '✕';
  const ta = panel.querySelector('.salasel-np-text');
  ta.placeholder = t(notesLang, 'notesPlaceholder');
  panel.querySelector('.salasel-np-dl-video').textContent =
    t(notesLang, 'notesDownloadVideo');
  const plBtn = panel.querySelector('.salasel-np-dl-playlist');
  plBtn.textContent = t(notesLang, 'notesDownloadPlaylist');
  // Playlist download only relevant when a playlist is present.
  plBtn.style.display = getCurrentPlaylistId() ? '' : 'none';
}

/** Open the panel bound to videoId and load its stored note. */
async function openPanel(videoId) {
  let panel = document.getElementById(NOTES_PANEL_ID);
  if (!panel) {
    panel = buildPanel();
    document.body.appendChild(panel);
  }
  applyPanelLabels(panel);

  boundVideoId = videoId;
  panelOpen = true;
  document.body.classList.add('salasel-notes-open');
  panel.classList.add('salasel-np--open');

  const textarea = panel.querySelector('.salasel-np-text');
  setStatus('');

  try {
    const record = await getNote(videoId);
    textarea.value = record ? record.text : '';
  } catch (_err) {
    textarea.value = '';
    showToast(t(notesLang, 'notesLoadError'));
  }
  textarea.focus();
}

/** Close the panel and restore layout. Flushes any pending save first. */
function closePanel() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    flushSave();
  }
  panelOpen = false;
  document.body.classList.remove('salasel-notes-open');
  const panel = document.getElementById(NOTES_PANEL_ID);
  if (panel) panel.classList.remove('salasel-np--open');
}

/** Update the small status text in the header. */
function setStatus(text) {
  const panel = document.getElementById(NOTES_PANEL_ID);
  if (panel) panel.querySelector('.salasel-np-status').textContent = text;
}

// ─── Editing / autosave ─────────────────────────────────────────────────────

function onTextInput(e) {
  const ta = e.target;
  if (ta.value.length >= NOTE_MAX_LENGTH) {
    showToast(t(notesLang, 'notesLimit'));
  }
  setStatus(t(notesLang, 'notesSaving'));
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
}

/** Persist the current textarea content for the bound video. */
async function flushSave() {
  saveTimer = null;
  const panel = document.getElementById(NOTES_PANEL_ID);
  if (!panel || !boundVideoId) return;
  const text = panel.querySelector('.salasel-np-text').value;

  try {
    // setNote writes chrome.storage.local[NOTES_KEY]; the salasel.js bridge
    // listens for that change and forwards the snapshot to the web app.
    await setNote(boundVideoId, text, getCurrentPlaylistId());
    setStatus(t(notesLang, 'notesSaved'));
  } catch (_err) {
    setStatus('');
    showToast(t(notesLang, 'notesSaveError'));
  }
}

// ─── Export / download ────────────────────────────────────────────────────────

/** Trigger a text-file download in the page. */
function downloadTextFile(filename, contents) {
  const type = filename.endsWith('.md')
    ? 'text/markdown;charset=utf-8'
    : 'text/plain;charset=utf-8';
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Format a single record as a Markdown block. */
function formatNote(record) {
  const url = `https://www.youtube.com/watch?v=${record.videoId}`;
  const lines = [];
  lines.push(`## [${record.videoId}](${url})`);
  lines.push('');
  if (record.playlistId) lines.push(`- **Playlist:** ${record.playlistId}`);
  lines.push(`- **Updated:** ${new Date(record.updatedAt).toISOString()}`);
  lines.push('');
  lines.push(record.text);
  return lines.join('\n');
}

/** Download the current video's note. */
async function downloadVideoNotes() {
  const videoId = getCurrentVideoId();
  if (!videoId) { showToast(t(notesLang, 'notesNoVideo')); return; }

  // Flush any pending edit so the export reflects the latest text.
  if (saveTimer) { clearTimeout(saveTimer); await flushSave(); }

  let record;
  try {
    record = await getNote(videoId);
  } catch (_err) {
    showToast(t(notesLang, 'notesLoadError'));
    return;
  }
  if (!record || record.text.trim() === '') {
    showToast(t(notesLang, 'notesNoteEmpty'));
    return;
  }
  downloadTextFile(`salasel-notes-${videoId}.md`, formatNote(record));
}

/** Download all notes for videos in the current playlist. */
async function downloadPlaylistNotes() {
  const playlistId = getCurrentPlaylistId();
  if (!playlistId) return;

  if (saveTimer) { clearTimeout(saveTimer); await flushSave(); }

  let store;
  try {
    store = await getNotesStore();
  } catch (_err) {
    showToast(t(notesLang, 'notesLoadError'));
    return;
  }

  const records = Object.values(store).filter(
    (r) => r && r.playlistId === playlistId && r.text.trim() !== ''
  );
  if (records.length === 0) {
    showToast(t(notesLang, 'notesPlaylistEmpty'));
    return;
  }

  records.sort((a, b) => a.updatedAt - b.updatedAt);
  const header = `# Salasel notes — playlist ${playlistId}\n\n` +
                 `> Exported: ${new Date().toISOString()}\n` +
                 `> ${records.length} video(s)\n`;
  const body = records.map(formatNote).join('\n\n---\n\n');
  downloadTextFile(`salasel-notes-playlist-${playlistId}.md`,
                   `${header}\n${body}\n`);
}

// ─── Language / prefs sync ──────────────────────────────────────────────────

/** Refresh language and re-render open UI. */
function refreshLanguage(lang) {
  notesLang = lang || notesLang;
  const btn = document.getElementById(NOTES_BTN_ID);
  if (btn) {
    btn.title = t(notesLang, 'notesButton');
    btn.setAttribute('aria-label', t(notesLang, 'notesButton'));
  }
  const panel = document.getElementById(NOTES_PANEL_ID);
  if (panel) applyPanelLabels(panel);
}

// ─── Observers ────────────────────────────────────────────────────────────────

let notesRaf = false;
let notesLastPath = location.pathname + location.search;

/** Re-assert the button and react to SPA navigation between videos. */
function onNotesMutation() {
  const nowLoc = location.pathname + location.search;
  if (nowLoc !== notesLastPath) {
    notesLastPath = nowLoc;
    const newId = getCurrentVideoId();
    // Video changed while panel open → rebind and reload.
    if (panelOpen && newId && newId !== boundVideoId) {
      openPanel(newId);
    } else if (panelOpen && !newId) {
      // Navigated away from a watch page → close panel.
      closePanel();
    }
  }

  if (notesRaf) return;
  notesRaf = true;
  requestAnimationFrame(() => {
    notesRaf = false;
    ensureButton();
  });
}

function startNotesObserver() {
  const obs = new MutationObserver(onNotesMutation);
  obs.observe(document.documentElement, { childList: true, subtree: true });
}

/** Close the panel if YouTube enters fullscreen while it's open. */
function onFullscreenChange() {
  if (isFullscreen() && panelOpen) closePanel();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

(async function initNotes() {
  try {
    const prefs = await getPrefs();
    notesLang = prefs.language || notesLang;
  } catch (_err) {
    // Keep default language.
  }

  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);

  // React to language changes from the popup.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.language) {
      refreshLanguage(changes.language.newValue);
    }
  });

  ensureButton();
  startNotesObserver();
})();
