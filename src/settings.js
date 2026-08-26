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

  const read = () => settings;

  // The cached snapshot is what keeps the keydown path synchronous; an await
  // there would change shortcut latency.
  const prime = (storage, onReady) => {
    storage.sync.get(DEFAULTS, (stored) => {
      settings = { ...settings, ...stored };
      if (onReady) onReady();
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

  VC.settings = { DEFAULTS, read, matchHost, shouldAutoTheater, isDisabledHere, prime };
})();
