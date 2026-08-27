(() => {
  const VC = (globalThis.__videoController ??= {});

  const DEFAULTS = {
    forward: 'ArrowRight',
    backward: 'ArrowLeft',
    volumeUp: 'ArrowUp',
    volumeDown: 'ArrowDown',
    theater: 't',
    playPause: ' ',
    mute: 'm',
    pip: 'p',
    seekSeconds: 5,
    autoTheaterDomains: [],
    disabledDomains: ['netflix.com', 'youtube.com'],
  };

  let settings = { ...DEFAULTS };

  const matchHost = (host, entry) => {
    if (!entry) return false;
    return host === entry || host.endsWith('.' + entry);
  };

  const shouldAutoTheater = () => {
    const host = (location.hostname || '').toLowerCase();
    const list = settings.autoTheaterDomains || [];
    return list.some((entry) => matchHost(host, (entry || '').toLowerCase()));
  };

  const isDisabledHere = () => {
    const host = (location.hostname || '').toLowerCase();
    const list = settings.disabledDomains || [];
    return list.some((entry) => matchHost(host, (entry || '').toLowerCase()));
  };


  // ---- per-site memory ----------------------------------------------------
  // A different thing from the two domain lists above: those are rules the user
  // declares (and match subdomains), this is an observation of what the user did
  // on one exact host. Separate store, separate matching, separate lifetime.

  let siteProfiles = {};
  let localStore = null;
  let syncStore = null;

  // Values can be objects (pan), so compare by shape rather than identity.
  const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const resolve = (defaults, profile) => ({ ...defaults, ...(profile || {}) });

  // Only non-default values are ever stored, and an entry that empties out is
  // deleted, so the map never accumulates rows that mean nothing.
  const nextProfiles = (profiles, host, key, value, defaults) => {
    const entry = { ...(profiles[host] || {}) };
    if (sameValue(value, defaults[key])) delete entry[key];
    else entry[key] = value;

    const next = { ...profiles };
    if (Object.keys(entry).length) next[host] = entry;
    else delete next[host];
    return next;
  };

  const siteHost = () => (location.hostname || '').toLowerCase();

  const readSite = (defaults) => resolve(defaults, siteProfiles[siteHost()]);

  const siteCount = () => Object.keys(siteProfiles[siteHost()] || {}).length;

  const setSiteValue = (key, value, defaults) => {
    if (isDisabledHere()) return;
    siteProfiles = nextProfiles(siteProfiles, siteHost(), key, value, defaults);
    if (localStore) localStore.set({ siteProfiles });
  };

  // The panel is the only UI now, so the global settings need a write path here
  // too. The onChanged listener below is what refreshes the cached snapshot, so
  // this does not have to.
  const save = (patch) => {
    if (syncStore) syncStore.set(patch);
  };

  const clearSite = () => {
    const next = { ...siteProfiles };
    delete next[siteHost()];
    siteProfiles = next;
    if (localStore) localStore.set({ siteProfiles });
  };

  const read = () => settings;

  // The cached snapshot is what keeps the keydown path synchronous; an await
  // there would change shortcut latency.
  const prime = (storage, onReady) => {
    localStore = storage.local;
    syncStore = storage.sync;
    let pending = 2;
    const done = () => { if (--pending === 0 && onReady) onReady(); };
    storage.sync.get(DEFAULTS, (stored) => {
      settings = { ...settings, ...stored };
      done();
    });
    storage.local.get({ siteProfiles: {} }, (stored) => {
      siteProfiles = stored.siteProfiles || {};
      done();
    });
    storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const next = { ...settings };
      for (const [key, { newValue }] of Object.entries(changes)) {
        if (key in next) next[key] = newValue;
      }
      settings = next;
    });
  };

  VC.settings = {
    DEFAULTS, read, matchHost, shouldAutoTheater, isDisabledHere, prime,
    resolve, nextProfiles, readSite, setSiteValue, clearSite, siteCount, save,
  };
})();
