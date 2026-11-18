'use strict';

// MV3 service workers do not share content-script globals. Load the validated
// storage helpers, then keep every continue-watching read/merge/write in one
// worker-owned queue across all Salasel tabs.
if (typeof importScripts === 'function') importScripts('storage.js');

let continueWatchingUpdateQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'salasel:continue-watching:update') return false;

  continueWatchingUpdateQueue = continueWatchingUpdateQueue
    .then(() => mergeContinueWatching(message.record))
    .then((record) => {
      sendResponse({ record });
    })
    .catch(() => {
      sendResponse({ record: null });
    });

  return true;
});
