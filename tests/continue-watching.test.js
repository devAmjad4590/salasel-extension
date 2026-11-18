const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const storageSource = fs.readFileSync(path.join(root, 'src/storage.js'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(root, 'src/salasel.js'), 'utf8');

const MEDIA_ID = 'M7lc1UVf-VE';
const SECOND_MEDIA_ID = 'dQw4w9WgXcQ';

function activity(overrides = {}) {
  return {
    version: 1,
    kind: 'podcast',
    contentId: 'pod_01HZX3A9Y8W2N7Q4R6S5T0V1X2',
    mediaId: MEDIA_ID,
    title: 'Episode title',
    thumbnailId: SECOND_MEDIA_ID,
    destination: '/ar/podcast/pod_01HZX3A9Y8W2N7Q4R6S5T0V1X2',
    playedAt: 900,
    ...overrides,
  };
}

function createBridge({ state = {}, local = {}, sync = {}, now = 1_000 } = {}) {
  const localData = { ...local };
  const syncData = { ...sync };
  const listeners = [];
  const pageStorage = new Map([['progress-storage', JSON.stringify({ state })]]);
  const noop = () => {};
  let authorityQueue = Promise.resolve();
  let context;
  context = {
    console,
    JSON,
    Object,
    Array,
    Set,
    Promise,
    Number,
    String,
    Error,
    Event: class Event { constructor(type) { this.type = type; } },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    Date: class FixedDate extends Date { static now() { return now; } },
    setTimeout: () => 1,
    clearTimeout: noop,
    setInterval: () => 1,
    clearInterval: noop,
    fetch: async () => { throw new Error('unexpected fetch'); },
    window: {
      localStorage: {
        getItem: (key) => pageStorage.get(key) ?? null,
        setItem: (key, value) => pageStorage.set(key, value),
      },
      addEventListener: noop,
      dispatchEvent: noop,
    },
    document: { addEventListener: noop, visibilityState: 'visible' },
    history: { pushState: noop, replaceState: noop },
    chrome: {
      storage: {
        local: {
          get: async (key) => ({ [key]: localData[key] }),
          set: async (value) => {
            const changes = {};
            for (const [key, next] of Object.entries(value)) {
              changes[key] = { oldValue: localData[key], newValue: next };
              localData[key] = next;
            }
            for (const listener of listeners) listener(changes, 'local');
          },
        },
        sync: {
          get: async (defaults) => ({ ...defaults, ...syncData }),
          set: async (value) => Object.assign(syncData, value),
        },
        onChanged: { addListener: (listener) => listeners.push(listener) },
      },
      runtime: {
        sendMessage: (message) => {
          const task = authorityQueue.then(() => context.mergeContinueWatching(message.record));
          authorityQueue = task.catch(() => null);
          return task.then((record) => ({ record }));
        },
      },
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(`${storageSource}\n${bridgeSource}\nglobalThis.__bridgeTestApi = { syncContinueWatching, getContinueWatching };`, context, { filename: 'salasel-bridge.js' });

  return {
    data: localData,
    setState(next) { pageStorage.set('progress-storage', JSON.stringify({ state: next })); },
    sync: () => context.__bridgeTestApi.syncContinueWatching(),
    getContinueWatching: () => context.__bridgeTestApi.getContinueWatching(),
  };
}

test('bridges newest podcast, playlist video, and standalone video to canonical Salasel destinations', async () => {
  const bridge = createBridge({ state: { latestActivity: activity() } });
  await bridge.sync();
  assert.deepEqual(JSON.parse(JSON.stringify(bridge.data.continueWatching)), {
    version: 1,
    kind: 'podcast',
    contentId: 'pod_01HZX3A9Y8W2N7Q4R6S5T0V1X2',
    mediaId: MEDIA_ID,
    title: 'Episode title',
    thumbnailId: SECOND_MEDIA_ID,
    destination: 'https://salasel.app/ar/podcast/pod_01HZX3A9Y8W2N7Q4R6S5T0V1X2/watch',
    playedAt: 900,
  });

  bridge.setState({ latestActivity: activity({
    kind: 'playlist-video',
    contentId: SECOND_MEDIA_ID,
    mediaId: SECOND_MEDIA_ID,
    playlistId: 'PL123',
    playlistName: 'Series title',
    title: 'Playlist episode',
    thumbnailId: SECOND_MEDIA_ID,
    destination: `/en/playlist/PL123/${SECOND_MEDIA_ID}`,
    playedAt: 901,
  }) });
  await bridge.sync();
  assert.equal(bridge.data.continueWatching.kind, 'playlist-video');
  assert.equal(bridge.data.continueWatching.destination, `https://salasel.app/en/playlist/PL123/${SECOND_MEDIA_ID}`);
  assert.equal(bridge.data.continueWatching.playlistName, 'Series title');

  bridge.setState({ latestActivity: activity({
    kind: 'video',
    contentId: MEDIA_ID,
    mediaId: MEDIA_ID,
    title: 'Standalone video',
    destination: `/ja/video/${MEDIA_ID}`,
    playedAt: 902,
  }) });
  await bridge.sync();
  assert.equal(bridge.data.continueWatching.kind, 'video');
  assert.equal(bridge.data.continueWatching.destination, `https://salasel.app/ja/video/${MEDIA_ID}`);

  bridge.setState({ latestActivity: activity({ title: 'Podcast again', playedAt: 903 }) });
  await bridge.sync();
  assert.equal(bridge.data.continueWatching.kind, 'podcast');
  assert.equal(bridge.data.continueWatching.destination, 'https://salasel.app/ar/podcast/pod_01HZX3A9Y8W2N7Q4R6S5T0V1X2/watch');
});

test('keeps newer source playback during delayed, equal, stale, future, and malformed handoffs', async () => {
  const newer = activity({ title: 'Newer', playedAt: 950 });
  const bridge = createBridge({ state: { latestActivity: newer } });
  const delayedNewer = bridge.sync();
  bridge.setState({ latestActivity: activity({ title: 'Older', playedAt: 949 }) });
  await Promise.all([delayedNewer, bridge.sync()]);
  assert.equal(bridge.data.continueWatching.title, 'Newer');

  for (const candidate of [
    activity({ title: 'Equal', playedAt: 950 }),
    activity({ title: 'Stale', playedAt: 949 }),
    activity({ title: 'Future', playedAt: 1_000 + 5 * 60_000 + 1 }),
    activity({ destination: '//evil.example/escape', playedAt: 951 }),
    activity({ destination: '/ar/video/not-the-media-id', playedAt: 951 }),
    { version: 2, playedAt: 999 },
  ]) {
    bridge.setState({ latestActivity: candidate });
    await bridge.sync();
    assert.equal(bridge.data.continueWatching.title, 'Newer');
  }
});

test('upgrades exact legacy playlist state without inventing a fallback and preserves notes and preferences', async () => {
  const bridge = createBridge({
    state: {
      lastWatched: {
        playlistId: 'PL123',
        videoId: MEDIA_ID,
        playlistName: 'Legacy series',
        thumbnailId: SECOND_MEDIA_ID,
        updatedAt: 800,
      },
      recentPlaylists: ['PLshould-not-be-used'],
      completedVideos: { PL123: [SECOND_MEDIA_ID] },
    },
    local: { salaselNotes: { [MEDIA_ID]: { text: 'keep me' } } },
    sync: { hideComments: true, language: 'en' },
  });
  await bridge.sync();
  assert.equal(bridge.data.continueWatching.kind, 'playlist-video');
  assert.equal(bridge.data.continueWatching.destination, `https://salasel.app/ar/playlist/PL123/${MEDIA_ID}`);
  assert.deepEqual(bridge.data.salaselNotes, { [MEDIA_ID]: { text: 'keep me' } });

  const noExactLegacy = createBridge({ state: { recentPlaylists: ['PL123'] } });
  await noExactLegacy.sync();
  assert.equal(noExactLegacy.data.continueWatching, undefined);

  const futureLegacy = createBridge({ state: {
    lastWatched: { playlistId: 'PL123', videoId: MEDIA_ID, updatedAt: 1_000 + 5 * 60_000 + 1 },
  } });
  await futureLegacy.sync();
  assert.equal(futureLegacy.data.continueWatching, undefined);

  const legacyWithoutDisplayName = createBridge({ state: {
    lastWatched: { playlistId: 'PL123', videoId: MEDIA_ID, playlistName: ' ', updatedAt: 801 },
  } });
  await legacyWithoutDisplayName.sync();
  assert.equal(legacyWithoutDisplayName.data.continueWatching.title, 'Salasel playlist');
});

test('keeps an exact legacy extension record usable when old display metadata is absent', async () => {
  const bridge = createBridge({ local: {
    continueWatching: { playlistId: 'PL123', resumeVideoId: MEDIA_ID, updatedAt: 800 },
  } });
  const record = await bridge.getContinueWatching();
  assert.equal(record.title, 'Salasel playlist');
  assert.equal(record.destination, `https://salasel.app/ar/playlist/PL123/${MEDIA_ID}`);
});

test('does not expose untrusted existing bridge records to the Continue card', async () => {
  const bridge = createBridge({ local: {
    continueWatching: {
      version: 1,
      kind: 'podcast',
      contentId: 'pod_safe',
      mediaId: MEDIA_ID,
      title: 'Unsafe',
      destination: 'https://evil.example/podcast/pod_safe',
      playedAt: 900,
    },
  } });
  assert.equal(await bridge.getContinueWatching(), null);
});

test('rejects unknown versioned and future legacy extension records instead of treating them as valid fallbacks', async () => {
  for (const continueWatching of [
    { version: 2, playlistId: 'PL123', resumeVideoId: MEDIA_ID, updatedAt: 800 },
    { playlistId: 'PL123', resumeVideoId: MEDIA_ID, updatedAt: 1_000 + 5 * 60_000 + 1 },
    { playlistId: 'PL123', resumeVideoId: 'short', updatedAt: 800 },
    { playlistId: 'PL123', resumeVideoId: MEDIA_ID, thumbnailId: 'not-an-id', updatedAt: 800 },
  ]) {
    const bridge = createBridge({ local: { continueWatching } });
    assert.equal(await bridge.getContinueWatching(), null);
  }
});

function createSharedStorage(initial = {}) {
  const data = { ...initial };
  let firstReadStarted;
  let releaseFirstRead;
  const firstRead = new Promise((resolve) => { firstReadStarted = resolve; });
  const release = new Promise((resolve) => { releaseFirstRead = resolve; });
  let reads = 0;
  return {
    data,
    firstRead,
    releaseFirstRead: () => releaseFirstRead(),
    local: {
      get: async (key) => {
        const snapshot = data[key];
        reads += 1;
        if (reads === 1) {
          firstReadStarted();
          await release;
        }
        return { [key]: snapshot };
      },
      set: async (value) => Object.assign(data, value),
    },
  };
}

function createWorkerAuthority(shared, now = 1_000) {
  const backgroundSource = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');
  let listener;
  const context = {
    console,
    JSON,
    Object,
    Array,
    Set,
    Promise,
    Number,
    String,
    Error,
    Date: class FixedDate extends Date { static now() { return now; } },
    chrome: {
      storage: { local: shared.local, sync: { get: async (defaults) => defaults, set: async () => {} } },
      runtime: { onMessage: { addListener: (next) => { listener = next; } } },
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(`${storageSource}\n${backgroundSource}`, context, { filename: 'background.js' });
  return {
    sendMessage(message) {
      return new Promise((resolve) => {
        const keptOpen = listener(message, {}, resolve);
        if (keptOpen !== true) resolve(undefined);
      });
    },
  };
}

function createIndependentStorageContext(shared, authority, now = 1_000) {
  const context = {
    console,
    JSON,
    Object,
    Array,
    Set,
    Promise,
    Number,
    String,
    Error,
    Date: class FixedDate extends Date { static now() { return now; } },
    chrome: {
      storage: { local: shared.local, sync: { get: async (defaults) => defaults, set: async () => {} } },
      runtime: { sendMessage: (message) => authority.sendMessage(message) },
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(`${storageSource}\nglobalThis.__storageApi = { createContinueWatchingRecord, updateContinueWatching };`, context, { filename: 'storage-client.js' });
  return context.__storageApi;
}

test('serializes forced interleaved activity updates from independent content-script contexts at the maximum source timestamp', async () => {
  const shared = createSharedStorage();
  const authority = createWorkerAuthority(shared);
  const firstContext = createIndependentStorageContext(shared, authority);
  const secondContext = createIndependentStorageContext(shared, authority);
  const older = firstContext.createContinueWatchingRecord(activity({ title: 'Older', playedAt: 949 }));
  const newer = secondContext.createContinueWatchingRecord(activity({ title: 'Newer', playedAt: 950 }));

  const delayedOlder = firstContext.updateContinueWatching(older);
  await shared.firstRead;
  const concurrentNewer = secondContext.updateContinueWatching(newer);
  shared.releaseFirstRead();
  await Promise.all([delayedOlder, concurrentNewer]);

  assert.equal(shared.data.continueWatching.playedAt, 950);
  assert.equal(shared.data.continueWatching.title, 'Newer');
});

test('new podcast watch routes bridge directly to playback with notes', async () => {
  const bridge = createBridge({ state: { latestActivity: activity({ destination: '/ar/podcast/pod_01HZX3A9Y8W2N7Q4R6S5T0V1X2/watch' }) } });
  await bridge.sync();
  assert.equal(bridge.data.continueWatching?.destination, 'https://salasel.app/ar/podcast/pod_01HZX3A9Y8W2N7Q4R6S5T0V1X2/watch');
});

test('legacy saved podcast routes normalize to watch without changing source time or content identity', async () => {
  const bridge = createBridge({ state: { latestActivity: activity() } });
  await bridge.sync();
  assert.equal(bridge.data.continueWatching.destination, 'https://salasel.app/ar/podcast/pod_01HZX3A9Y8W2N7Q4R6S5T0V1X2/watch');
  assert.equal(bridge.data.continueWatching.playedAt, 900);
  assert.equal(bridge.data.continueWatching.mediaId, MEDIA_ID);
});
