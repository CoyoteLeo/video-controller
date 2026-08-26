(() => {
  const VC = (globalThis.__videoController ??= {});

  const HOST_ID = '__video_controller_ui__';

  let host = null;
  let root = null;
  let toastEl = null;
  let toastTimer = null;
  let panelEl = null;
  let built = false;

  // One host, always mounted, never hidden. "Panel closed" hides the panel layer
  // only — hiding the host would kill every toast, which is the state the page is
  // in most of the time. pointer-events is off here and re-enabled per layer so
  // an always-mounted overlay never swallows a click meant for the page.
  const ensureHost = () => {
    if (host) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host, * { box-sizing: border-box; }
        .toast {
          position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
          padding: 8px 14px; background: rgba(0,0,0,0.72); color: #fff;
          font: 600 14px/1.2 -apple-system, system-ui, sans-serif;
          border-radius: 6px; opacity: 0; transition: opacity 0.2s;
        }
        .panel {
          position: fixed; top: 80px; right: 24px; width: 268px; display: none;
          pointer-events: auto;
          background: #fff; color: #222;
          border: 1px solid rgba(128,128,128,0.35); border-radius: 8px;
          box-shadow: 0 8px 28px rgba(0,0,0,0.28);
          font: 13px/1.4 -apple-system, system-ui, sans-serif;
        }
        .panel.open { display: block; }
        @media (prefers-color-scheme: dark) {
          .panel { background: #1e1e1e; color: #eee; }
        }
        header {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 10px; cursor: move;
          border-bottom: 1px solid rgba(128,128,128,0.25);
        }
        header .title { flex: 1; font-weight: 600; }
        header button { border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; }
        .body { padding: 8px 10px 10px; max-height: 70vh; overflow-y: auto; }
        .row { display: flex; align-items: center; gap: 6px; margin-bottom: 7px; }
        .row .label { flex: 1; opacity: 0.75; }
        button.act {
          padding: 4px 8px; border-radius: 4px; cursor: pointer; font: inherit;
          border: 1px solid rgba(128,128,128,0.5); background: transparent; color: inherit;
        }
        button.act:hover { border-color: #0a7; }
        button.act.on { border-color: #0a7; background: rgba(0,170,119,0.12); }
        input[type="range"] { flex: 1; accent-color: #0a7; }
        input[type="number"] {
          width: 62px; padding: 3px 5px; font: inherit; color: inherit;
          background: transparent; border: 1px solid rgba(128,128,128,0.5); border-radius: 4px;
        }
        .val { min-width: 46px; text-align: right; font-variant-numeric: tabular-nums; opacity: 0.8; }
        .section { margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(128,128,128,0.25); }
        .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.6; margin-bottom: 6px; }
        .note { font-size: 11px; opacity: 0.6; margin-top: 4px; }
        .memory { display: flex; align-items: center; gap: 6px; font-size: 12px; }
        .memory .count { flex: 1; opacity: 0.75; }
        ul.videos { list-style: none; margin: 0; padding: 0; }
        ul.videos li { margin-bottom: 4px; }
        ul.videos button { width: 100%; text-align: left; }
        .empty { opacity: 0.6; font-size: 12px; }
        .tabs { display: flex; gap: 2px; padding: 0 10px; border-bottom: 1px solid rgba(128,128,128,0.25); }
        .tab {
          padding: 6px 9px; border: 0; background: transparent; color: inherit; font: inherit;
          cursor: pointer; border-bottom: 2px solid transparent; opacity: 0.6;
        }
        .tab.active { opacity: 1; border-bottom-color: #0a7; font-weight: 600; }
        .key-btn {
          min-width: 88px; padding: 4px 8px; border-radius: 4px; cursor: pointer; font: inherit;
          border: 1px solid rgba(128,128,128,0.5); background: transparent; color: inherit; text-align: center;
        }
        .key-btn.listening { border-color: #0a7; background: rgba(0,170,119,0.12); }
        textarea {
          width: 100%; min-height: 54px; padding: 5px 7px; border-radius: 4px; resize: vertical;
          border: 1px solid rgba(128,128,128,0.5); background: transparent; color: inherit;
          font: 11px/1.4 ui-monospace, Menlo, monospace;
        }
        textarea:focus { outline: none; border-color: #0a7; }
        .actions { display: flex; gap: 6px; margin-top: 10px; }
        .actions button { flex: 1; }
        button.primary {
          padding: 5px 9px; border-radius: 4px; cursor: pointer; font: inherit;
          border: 1px solid #0a7; background: #0a7; color: #fff;
        }
        .status { min-height: 14px; margin-top: 6px; font-size: 11px; color: #0a7; text-align: center; }
      </style>
      <div class="toast" part="toast"></div>
      <div class="panel"></div>
    `;
    toastEl = root.querySelector('.toast');
    panelEl = root.querySelector('.panel');
    document.documentElement.appendChild(host);
  };

  const showToast = (text) => {
    ensureHost();
    toastEl.textContent = text;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (toastEl) toastEl.style.opacity = '0'; }, 900);
  };

  // The values this panel is allowed to remember per site, and what "unset" means
  // for each. The effect half is owned by transform.js — this only adds the two
  // playback values and the panel's own position.
  const siteDefaults = () => ({
    ...VC.transform.DEFAULT_EFFECTS,
    rate: 1,
    loop: false,
    panelX: null,
    panelY: null,
  });

  const remember = (key, value) => VC.settings.setSiteValue(key, value, siteDefaults());

  const target = () => VC.videos.pick();

  const applyEffect = (patch) => {
    VC.presentation.apply(patch);
    const e = VC.presentation.current();
    for (const key of Object.keys(patch)) remember(key, e[key]);
    render();
  };

  const setRate = (rate) => {
    const v = target();
    if (!v) return;
    const applied = VC.playback.setRate(v, rate);
    remember('rate', applied);
    render();
  };

  let abPoints = { a: null, b: null };

  const build = () => {
    panelEl.innerHTML = `
      <header>
        <span class="title">Video Controller</span>
        <button class="close" aria-label="Close panel">✕</button>
      </header>
      <div class="tabs">
        <button class="tab" data-tab="page">This page</button>
        <button class="tab" data-tab="settings">Settings</button>
      </div>
      <div class="body"></div>
    `;
    panelEl.querySelector('.close').addEventListener('click', close);
    makeDraggable(panelEl.querySelector('header'));
    built = true;
  };

  const makeDraggable = (handle) => {
    let dx = 0;
    let dy = 0;
    const onMove = (e) => {
      panelEl.style.left = `${e.clientX - dx}px`;
      panelEl.style.top = `${e.clientY - dy}px`;
      panelEl.style.right = 'auto';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      remember('panelX', parseInt(panelEl.style.left, 10));
      remember('panelY', parseInt(panelEl.style.top, 10));
    };
    handle.addEventListener('mousedown', (e) => {
      const r = panelEl.getBoundingClientRect();
      dx = e.clientX - r.left;
      dy = e.clientY - r.top;
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
      e.preventDefault();
    });
  };

  const fmt = (n, digits = 2) => Number(n.toFixed(digits)).toString();

  const render = () => {
    if (!built) return;
    for (const el of panelEl.querySelectorAll('.tab')) {
      el.classList.toggle('active', el.dataset.tab === tab);
    }
    if (tab === 'settings') { renderSettings(); return; }
    if (openMode === 'settings') { renderBlocked(); return; }
    renderControls();
  };

  const renderBlocked = () => {
    panelEl.querySelector('.body').innerHTML = `
      <div class="empty">Video Controller is disabled on this site, so there is nothing to
      control here. Remove the domain from the Block List under Settings to enable it.</div>
    `;
  };

  const renderControls = () => {
    const e = VC.presentation.current();
    const v = target();
    const rate = v ? v.playbackRate : 1;
    const count = VC.settings.siteCount();
    const ab = VC.playback.currentRepeat();

    panelEl.querySelector('.body').innerHTML = `
      ${v ? '' : '<div class="empty">No video detected on this page yet.</div>'}
      <div class="section-title">Transform</div>
      <div class="row">
        <span class="label">Rotate</span>
        <button class="act" data-act="rot-ccw">⟲ 90°</button>
        <button class="act" data-act="rot-cw">⟳ 90°</button>
        <span class="val">${fmt(e.rotate, 0)}°</span>
      </div>
      <div class="row">
        <span class="label">Angle</span>
        <input type="range" data-act="rot-free" min="0" max="359" step="1" value="${e.rotate % 360}">
      </div>
      <div class="row">
        <span class="label">Flip</span>
        <button class="act ${e.flipX ? 'on' : ''}" data-act="flip-x">Horizontal</button>
        <button class="act ${e.flipY ? 'on' : ''}" data-act="flip-y">Vertical</button>
      </div>
      <div class="row">
        <span class="label">Zoom</span>
        <input type="range" data-act="zoom" min="0.25" max="4" step="0.05" value="${e.zoom}">
        <span class="val">${fmt(e.zoom)}×</span>
      </div>
      <div class="row">
        <span class="label">Pan</span>
        <button class="act" data-act="pan-left">←</button>
        <button class="act" data-act="pan-right">→</button>
        <button class="act" data-act="pan-up">↑</button>
        <button class="act" data-act="pan-down">↓</button>
      </div>

      <div class="section">
        <div class="section-title">Playback</div>
        <div class="row">
          <span class="label">Speed</span>
          <input type="range" data-act="rate" min="0.25" max="4" step="0.05" value="${rate}">
          <span class="val">${fmt(rate)}×</span>
        </div>
        <div class="row">
          <span class="label">Loop</span>
          <button class="act ${v && v.loop ? 'on' : ''}" data-act="loop">${v && v.loop ? 'On' : 'Off'}</button>
        </div>
        <div class="row">
          <span class="label">A-B repeat</span>
          <button class="act ${abPoints.a !== null ? 'on' : ''}" data-act="set-a">A</button>
          <button class="act ${abPoints.b !== null ? 'on' : ''}" data-act="set-b">B</button>
          <button class="act" data-act="clear-ab">Clear</button>
        </div>
        ${ab ? `<div class="note">Repeating ${fmt(ab.a, 1)}s – ${fmt(ab.b, 1)}s</div>` : ''}
        <div class="row">
          <span class="label">Frame step</span>
          <button class="act" data-act="frame-back">◀</button>
          <button class="act" data-act="frame-fwd">▶</button>
          <input type="number" data-act="fps" min="1" max="240" step="1" value="${fps}">
        </div>
        <div class="note">Frame stepping is approximate — the API does not expose a video's real frame rate.</div>
      </div>

      <div class="section">
        <div class="section-title">Video</div>
        <ul class="videos"></ul>
      </div>

      <div class="section">
        <div class="memory">
          <span class="count">${count ? `${count} setting${count > 1 ? 's' : ''} remembered for this site` : 'Nothing remembered for this site'}</span>
          <button class="act" data-act="forget" ${count ? '' : 'disabled'}>Clear</button>
        </div>
        <div class="row" style="margin-top:8px">
          <button class="act" data-act="reset" style="flex:1">Reset everything</button>
        </div>
      </div>
    `;
    renderVideos();
  };

  const PRETTY = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', ' ': 'Space', Escape: 'Esc',
  };
  const prettyKey = (k) => (!k ? '—' : (PRETTY[k] || (k.length === 1 ? k.toUpperCase() : k)));

  const BINDINGS = [
    ['forward', 'Forward'], ['backward', 'Backward'],
    ['volumeUp', 'Volume up'], ['volumeDown', 'Volume down'],
    ['theater', 'Theater mode'], ['playPause', 'Play / pause'],
    ['mute', 'Mute'], ['pip', 'Picture in picture'],
  ];

  const normalizeDomain = (raw) => (raw || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\./, '');

  const parseDomains = (text) => Array.from(new Set(
    (text || '').split(/[\r\n,]+/).map(normalizeDomain).filter(Boolean)));

  const renderSettings = () => {
    const s = VC.settings.read();
    panelEl.querySelector('.body').innerHTML = `
      <div class="section-title">Shortcuts</div>
      ${BINDINGS.map(([action, label]) => `
        <div class="row">
          <span class="label">${label}</span>
          <button class="key-btn ${capturing === action ? 'listening' : ''}" data-bind="${action}">${capturing === action ? 'Press a key…' : prettyKey(s[action])}</button>
        </div>`).join('')}
      <div class="note">Click a binding, then press a key. Esc cancels.</div>

      <div class="row" style="margin-top:10px">
        <span class="label">Seek step (seconds)</span>
        <input type="number" data-set="seekSeconds" min="1" max="600" step="1" value="${s.seekSeconds}">
      </div>

      <div class="section">
        <div class="section-title">Auto theater</div>
        <textarea data-set="autoTheaterDomains" placeholder="One domain per line">${(s.autoTheaterDomains || []).join('\n')}</textarea>
        <div class="note">Theater mode starts automatically on these domains. Subdomains are matched.</div>
      </div>

      <div class="section">
        <div class="section-title">Block list</div>
        <textarea data-set="disabledDomains" placeholder="One domain per line">${(s.disabledDomains || []).join('\n')}</textarea>
        <div class="note">Everything is disabled on these domains — shortcuts and this panel's controls both.</div>
      </div>

      <div class="actions">
        <button class="act" data-act="settings-reset">Reset</button>
        <button class="primary" data-act="settings-save">Save</button>
      </div>
      <div class="status"></div>
    `;
  };

  let fps = VC.playback.DEFAULT_FPS;
  let tab = 'page';
  let openMode = 'full';
  let capturing = null;
  let videoList = [];

  const renderVideos = () => {
    const ul = panelEl.querySelector('ul.videos');
    if (!ul) return;
    if (!videoList.length) {
      ul.innerHTML = '<li class="empty">Looking for videos…</li>';
      return;
    }
    const picked = VC.videos.pickedId();
    ul.innerHTML = videoList.map((item) => `
      <li><button class="act ${item.id === picked ? 'on' : ''}" data-pick="${item.id}">
        ${item.width}×${item.height}${item.duration ? ` · ${fmt(item.duration, 0)}s` : ''}${item.playing ? ' · playing' : ''}${item.frame ? ' · iframe' : ''}
      </button></li>
    `).join('');
  };

  const refreshVideos = () => {
    VC.videos.list((items) => { videoList = items; renderVideos(); });
  };

  const PAN_STEP = 20;

  const onClick = (e) => {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      tab = tabBtn.dataset.tab;
      capturing = null;
      render();
      return;
    }

    const bind = e.target.closest('[data-bind]');
    if (bind) {
      capturing = capturing === bind.dataset.bind ? null : bind.dataset.bind;
      render();
      return;
    }

    const pick = e.target.closest('[data-pick]');
    if (pick) {
      VC.videos.setPicked(pick.dataset.pick);
      renderVideos();
      return;
    }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const eff = VC.presentation.current();
    const v = target();
    switch (el.dataset.act) {
      case 'rot-cw': applyEffect({ rotate: (eff.rotate + 90) % 360 }); break;
      case 'rot-ccw': applyEffect({ rotate: (eff.rotate + 270) % 360 }); break;
      case 'flip-x': applyEffect({ flipX: !eff.flipX }); break;
      case 'flip-y': applyEffect({ flipY: !eff.flipY }); break;
      case 'pan-left': applyEffect({ pan: { x: eff.pan.x - PAN_STEP, y: eff.pan.y } }); break;
      case 'pan-right': applyEffect({ pan: { x: eff.pan.x + PAN_STEP, y: eff.pan.y } }); break;
      case 'pan-up': applyEffect({ pan: { x: eff.pan.x, y: eff.pan.y - PAN_STEP } }); break;
      case 'pan-down': applyEffect({ pan: { x: eff.pan.x, y: eff.pan.y + PAN_STEP } }); break;
      case 'loop':
        if (v) { VC.playback.setLoop(v, !v.loop); remember('loop', v.loop); render(); }
        break;
      case 'set-a':
        if (v) { abPoints = { ...abPoints, a: v.currentTime }; VC.playback.setRepeat(v, abPoints.a, abPoints.b); render(); }
        break;
      case 'set-b':
        if (v) { abPoints = { ...abPoints, b: v.currentTime }; VC.playback.setRepeat(v, abPoints.a, abPoints.b); render(); }
        break;
      case 'clear-ab':
        abPoints = { a: null, b: null };
        VC.playback.clearRepeat();
        render();
        break;
      case 'frame-back': if (v) VC.playback.stepFrames(v, -1, fps); break;
      case 'frame-fwd': if (v) VC.playback.stepFrames(v, 1, fps); break;
      case 'forget':
        VC.settings.clearSite();
        VC.presentation.reset();
        if (v) VC.playback.setRate(v, 1);
        render();
        break;
      case 'settings-save': saveSettings(); break;
      case 'settings-reset':
        VC.settings.save({ ...VC.settings.DEFAULTS });
        setTimeout(render, 60);
        break;
      case 'reset':
        VC.presentation.reset();
        if (v) { VC.playback.setRate(v, 1); VC.playback.setLoop(v, false); }
        VC.playback.clearRepeat();
        abPoints = { a: null, b: null };
        render();
        break;
      default: break;
    }
  };

  const onInput = (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const value = Number(el.value);
    switch (el.dataset.act) {
      case 'rot-free': applyEffect({ rotate: value }); break;
      case 'zoom': applyEffect({ zoom: value }); break;
      case 'rate': setRate(value); break;
      case 'fps': fps = Math.min(240, Math.max(1, value || VC.playback.DEFAULT_FPS)); break;
      default: break;
    }
  };

  const saveSettings = () => {
    const body = panelEl.querySelector('.body');
    const secs = Number(body.querySelector('[data-set="seekSeconds"]').value);
    VC.settings.save({
      seekSeconds: Number.isFinite(secs) && secs > 0
        ? Math.min(600, Math.floor(secs)) : VC.settings.DEFAULTS.seekSeconds,
      autoTheaterDomains: parseDomains(body.querySelector('[data-set="autoTheaterDomains"]').value),
      disabledDomains: parseDomains(body.querySelector('[data-set="disabledDomains"]').value),
    });
    const status = body.querySelector('.status');
    if (status) status.textContent = 'Saved';
    setTimeout(() => { if (status) status.textContent = ''; }, 1200);
  };

  // While a binding is being captured the shortcut handler must stand down, or
  // pressing `t` to rebind it would toggle theater instead.
  const onCaptureKey = (e) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape') { capturing = null; render(); return; }
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    const patch = { [capturing]: e.key };
    // A key can only mean one thing, so taking it clears it from anywhere else.
    const current = VC.settings.read();
    for (const [action] of BINDINGS) {
      if (action !== capturing && current[action] === e.key) patch[action] = '';
    }
    VC.settings.save(patch);
    capturing = null;
    setTimeout(render, 60);
  };

  const open = (mode) => {
    openMode = mode === 'settings' ? 'settings' : 'full';
    if (openMode === 'settings') tab = 'settings';
    ensureHost();
    if (!built) {
      build();
      panelEl.addEventListener('click', onClick);
      panelEl.addEventListener('input', onInput);
      window.addEventListener('keydown', onCaptureKey, true);
    }
    const stored = VC.settings.readSite(siteDefaults());
    if (stored.panelX !== null && stored.panelY !== null) {
      panelEl.style.left = `${stored.panelX}px`;
      panelEl.style.top = `${stored.panelY}px`;
      panelEl.style.right = 'auto';
    }
    panelEl.classList.add('open');
    render();
    refreshVideos();
  };

  const close = () => {
    if (panelEl) panelEl.classList.remove('open');
  };

  const isOpen = () => !!panelEl && panelEl.classList.contains('open');

  VC.panel = { showToast, open, close, isOpen, render, refreshVideos, isCapturing: () => !!capturing };
})();
