const MSG_TAG = '__video_controller_v1__';

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

const BINDINGS = [
  ['forward', 'Forward'], ['backward', 'Backward'],
  ['volumeUp', 'Volume up'], ['volumeDown', 'Volume down'],
  ['theater', 'Theater mode'], ['playPause', 'Play / pause'],
  ['mute', 'Mute'], ['pip', 'Picture in picture'],
];

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 2) => Number(Number(n).toFixed(d)).toString();

// ---- page connection -------------------------------------------------------
// The panel is its own document, so everything it shows comes from the content
// script. No reply means no content script on this tab, which is a different
// answer from "this domain is blocked".
let tabId = null;
let state = null;      // null = unreachable
let settings = { ...DEFAULTS };
let openTile = null;
let listening = null;
let fps = 30;

const send = (msg) => new Promise((resolve) => {
  if (tabId === null) return resolve(null);
  try {
    chrome.tabs.sendMessage(tabId, { tag: MSG_TAG, ...msg }, (reply) => {
      if (chrome.runtime.lastError) return resolve(null);
      return resolve(reply || null);
    });
  } catch (_) {
    resolve(null);
  }
});

const refresh = async () => {
  state = await send({ type: 'state' });
  render();
};

const run = async (name, extra = {}) => {
  state = await send({ type: 'command', name, ...extra });
  render();
};

// ---- tiles -----------------------------------------------------------------
const TILES = [
  { id: 'rotate', glyph: '⟳', label: 'Rotate' },
  { id: 'flip', glyph: '⇋', label: 'Flip' },
  { id: 'zoom', glyph: '⤢', label: 'Zoom' },
  { id: 'pan', glyph: '✥', label: 'Pan' },
  { id: 'speed', glyph: '⏩', label: 'Speed' },
  { id: 'loop', glyph: '🔁', label: 'Loop', instant: true },
  { id: 'ab', glyph: '↔', label: 'A-B' },
  { id: 'frame', glyph: '⏭', label: 'Frame' },
  { id: 'videos', glyph: '☰', label: 'Videos' },
  { id: 'theater', glyph: '🎬', label: 'Theater', instant: true },
  { id: 'pip', glyph: '🖼', label: 'PiP', instant: true },
  { id: 'reset', glyph: '⟲', label: 'Reset', instant: true },
];

const isActive = (id) => {
  if (!state) return false;
  const e = state.effects;
  switch (id) {
    case 'rotate': return e.rotate !== 0;
    case 'flip': return e.flipX || e.flipY;
    case 'zoom': return e.zoom !== 1;
    case 'pan': return e.pan.x !== 0 || e.pan.y !== 0;
    case 'speed': return state.rate !== 1;
    case 'loop': return state.loop;
    case 'ab': return !!state.ab;
    case 'theater': return e.theater;
    case 'videos': return !!state.picked;
    default: return false;
  }
};

const renderGrid = () => {
  const usable = !!state && state.enabled;
  $('grid').innerHTML = TILES.map((t) => `
    <button class="tile ${isActive(t.id) ? 'active' : ''} ${openTile === t.id ? 'active' : ''}"
            data-tile="${t.id}" ${usable ? '' : 'disabled'}>
      <span class="glyph">${t.glyph}</span><span>${t.label}</span>
    </button>
  `).join('');
};

const detailFor = (id) => {
  const e = state.effects;
  switch (id) {
    case 'rotate': return `
      <h2>Rotate</h2>
      <div class="row">
        <button class="act" data-do="rot-ccw">⟲ 90°</button>
        <button class="act" data-do="rot-cw">⟳ 90°</button>
        <span class="val">${fmt(e.rotate, 0)}°</span>
      </div>
      <div class="row">
        <span class="label">Angle</span>
        <input type="range" data-live="rotate" min="0" max="359" step="1" value="${e.rotate % 360}">
      </div>`;
    case 'flip': return `
      <h2>Flip</h2>
      <div class="row">
        <button class="act ${e.flipX ? 'on' : ''}" data-do="flip-x">Horizontal</button>
        <button class="act ${e.flipY ? 'on' : ''}" data-do="flip-y">Vertical</button>
      </div>`;
    case 'zoom': return `
      <h2>Zoom</h2>
      <div class="row">
        <input type="range" data-live="zoom" min="0.25" max="4" step="0.05" value="${e.zoom}">
        <span class="val">${fmt(e.zoom)}×</span>
      </div>`;
    case 'pan': return `
      <h2>Pan</h2>
      <div class="row">
        <button class="act" data-do="pan-left">←</button>
        <button class="act" data-do="pan-right">→</button>
        <button class="act" data-do="pan-up">↑</button>
        <button class="act" data-do="pan-down">↓</button>
        <span class="val">${e.pan.x},${e.pan.y}</span>
      </div>`;
    case 'speed': return `
      <h2>Speed</h2>
      <div class="row">
        <input type="range" data-live="rate" min="0.25" max="4" step="0.05" value="${state.rate}">
        <span class="val">${fmt(state.rate)}×</span>
      </div>
      <div class="hint">Beyond 4× is still reachable by keyboard; Chrome refuses past 16×.</div>`;
    case 'ab': return `
      <h2>A-B repeat</h2>
      <div class="row">
        <button class="act ${state.ab ? 'on' : ''}" data-do="ab-a">Set A</button>
        <button class="act ${state.ab ? 'on' : ''}" data-do="ab-b">Set B</button>
        <button class="act" data-do="ab-clear">Clear</button>
      </div>
      ${state.ab ? `<div class="hint">Repeating ${fmt(state.ab.a, 1)}s – ${fmt(state.ab.b, 1)}s</div>` : ''}`;
    case 'frame': return `
      <h2>Frame step</h2>
      <div class="row">
        <button class="act" data-do="frame-back">◀</button>
        <button class="act" data-do="frame-fwd">▶</button>
        <span class="label" style="text-align:right">fps</span>
        <input type="number" data-live="fps" min="1" max="240" step="1" value="${fps}">
      </div>
      <div class="hint">Approximate — the API does not expose a video's real frame rate.</div>`;
    case 'videos': return `
      <h2>Videos on this page</h2>
      ${state.videos.length ? `<ul class="videos">${state.videos.map((item) => `
        <li><button class="act ${item.id === state.picked ? 'on' : ''}" data-pick="${item.id}">
          ${item.width}×${item.height}${item.duration ? ` · ${fmt(item.duration, 0)}s` : ''}${item.playing ? ' · playing' : ''}${item.frame ? ' · iframe' : ''}
        </button></li>`).join('')}</ul>`
        : '<div class="hint">Looking for videos…</div>'}
      <div class="hint">Picking one also points the keyboard shortcuts at it.</div>`;
    default: return '';
  }
};

const render = () => {
  $('settings').hidden = true;
  $('main').hidden = false;

  if (!state) {
    $('notice').innerHTML = '<div class="notice">Video Controller does not run on this page. Browser pages and the Chrome Web Store are off limits to extensions.</div>';
  } else if (!state.enabled) {
    $('notice').innerHTML = '<div class="notice">Disabled on this site by your <b>block list</b>. Open Settings to remove the domain.</div>';
  } else if (!state.hasVideo) {
    $('notice').innerHTML = '<div class="notice">No video detected on this page yet.</div>';
  } else {
    $('notice').innerHTML = '';
  }

  $('who').textContent = state && state.enabled && state.videos.length > 1
    ? `${state.videos.length} videos` : '';

  renderGrid();

  const detail = $('detail');
  detail.innerHTML = state && state.enabled && openTile && !TILES.find((t) => t.id === openTile).instant
    ? `<div class="card">${detailFor(openTile)}</div>` : '';

  const count = state ? state.siteCount : 0;
  $('memory').textContent = count
    ? `${count} setting${count > 1 ? 's' : ''} remembered here`
    : 'Nothing remembered for this site';
  $('forget').disabled = !count;
};

// ---- settings view ---------------------------------------------------------
const PRETTY = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', ' ': 'Space', Escape: 'Esc' };
const prettyKey = (k) => (!k ? '—' : (PRETTY[k] || (k.length === 1 ? k.toUpperCase() : k)));

const normalizeDomain = (raw) => (raw || '').trim().toLowerCase()
  .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\./, '');
const parseDomains = (text) => Array.from(new Set(
  (text || '').split(/[\r\n,]+/).map(normalizeDomain).filter(Boolean)));

const renderSettings = () => {
  $('main').hidden = true;
  $('settings').hidden = false;
  $('settings').innerHTML = `
    <h2>Shortcuts</h2>
    ${BINDINGS.map(([action, label]) => `
      <div class="row">
        <span class="label">${label}</span>
        <button class="key-btn ${listening === action ? 'listening' : ''}" data-bind="${action}">${listening === action ? 'Press a key…' : prettyKey(settings[action])}</button>
      </div>`).join('')}
    <div class="hint">Click a binding, then press a key. Esc cancels.</div>

    <div class="row" style="margin-top:10px">
      <span class="label">Seek step (seconds)</span>
      <input type="number" id="seekSeconds" min="1" max="600" step="1" value="${settings.seekSeconds}">
    </div>

    <div class="section">
      <h2>Auto theater</h2>
      <textarea id="autoDomains" placeholder="One domain per line">${(settings.autoTheaterDomains || []).join('\n')}</textarea>
      <div class="hint">Theater mode starts automatically on these domains. Subdomains are matched.</div>
    </div>

    <div class="section">
      <h2>Block list</h2>
      <textarea id="blockDomains" placeholder="One domain per line">${(settings.disabledDomains || []).join('\n')}</textarea>
      <div class="hint">Everything is disabled on these domains — shortcuts and controls both.</div>
    </div>

    <div class="actions">
      <button class="secondary" id="resetSettings">Reset</button>
      <button class="primary" id="saveSettings">Save</button>
    </div>
    <div class="status" id="status"></div>
  `;
};

const saveSettings = async () => {
  const secs = Number($('seekSeconds').value);
  const next = {
    ...settings,
    seekSeconds: Number.isFinite(secs) && secs > 0 ? Math.min(600, Math.floor(secs)) : DEFAULTS.seekSeconds,
    autoTheaterDomains: parseDomains($('autoDomains').value),
    disabledDomains: parseDomains($('blockDomains').value),
  };
  settings = next;
  await chrome.storage.sync.set(next);
  const status = $('status');
  if (status) {
    status.textContent = 'Saved';
    setTimeout(() => { if ($('status')) $('status').textContent = ''; }, 1200);
  }
  // The block list may have just changed what this tab allows.
  refresh().then(() => { if (!$('settings').hidden) renderSettings(); });
};

// ---- events ----------------------------------------------------------------
const PAN = 20;

document.addEventListener('click', async (ev) => {
  const gear = ev.target.closest('#gear');
  if (gear) {
    if ($('settings').hidden) renderSettings();
    else render();
    return;
  }

  const bind = ev.target.closest('[data-bind]');
  if (bind) {
    listening = listening === bind.dataset.bind ? null : bind.dataset.bind;
    renderSettings();
    return;
  }
  if (ev.target.closest('#saveSettings')) return saveSettings();
  if (ev.target.closest('#resetSettings')) {
    settings = { ...DEFAULTS };
    await chrome.storage.sync.set(settings);
    renderSettings();
    return;
  }
  if (ev.target.closest('#forget')) return run('forget');

  const tile = ev.target.closest('[data-tile]');
  if (tile) {
    const id = tile.dataset.tile;
    const spec = TILES.find((t) => t.id === id);
    if (spec.instant) {
      if (id === 'reset') { openTile = null; return run('reset'); }
      return run(id);
    }
    openTile = openTile === id ? null : id;
    if (id === 'videos') run('refresh');
    else render();
    return;
  }

  const pick = ev.target.closest('[data-pick]');
  if (pick) return run('pick', { id: pick.dataset.pick });

  const doEl = ev.target.closest('[data-do]');
  if (!doEl || !state) return;
  const e = state.effects;
  switch (doEl.dataset.do) {
    case 'rot-cw': return run('effect', { patch: { rotate: (e.rotate + 90) % 360 } });
    case 'rot-ccw': return run('effect', { patch: { rotate: (e.rotate + 270) % 360 } });
    case 'flip-x': return run('effect', { patch: { flipX: !e.flipX } });
    case 'flip-y': return run('effect', { patch: { flipY: !e.flipY } });
    case 'pan-left': return run('effect', { patch: { pan: { x: e.pan.x - PAN, y: e.pan.y } } });
    case 'pan-right': return run('effect', { patch: { pan: { x: e.pan.x + PAN, y: e.pan.y } } });
    case 'pan-up': return run('effect', { patch: { pan: { x: e.pan.x, y: e.pan.y - PAN } } });
    case 'pan-down': return run('effect', { patch: { pan: { x: e.pan.x, y: e.pan.y + PAN } } });
    case 'ab-a': return run('ab', { point: 'a' });
    case 'ab-b': return run('ab', { point: 'b' });
    case 'ab-clear': return run('ab', { point: 'clear' });
    case 'frame-back': return run('frame', { frames: -1, fps });
    case 'frame-fwd': return run('frame', { frames: 1, fps });
    default: return undefined;
  }
});

document.addEventListener('input', (ev) => {
  const el = ev.target.closest('[data-live]');
  if (!el) return;
  const value = Number(el.value);
  switch (el.dataset.live) {
    case 'rotate': return run('effect', { patch: { rotate: value } });
    case 'zoom': return run('effect', { patch: { zoom: value } });
    case 'rate': return run('rate', { value });
    case 'fps': fps = Math.min(240, Math.max(1, value || 30)); return undefined;
    default: return undefined;
  }
});

document.addEventListener('keydown', async (ev) => {
  if (!listening) return;
  if (ev.target.tagName === 'TEXTAREA' || ev.target.tagName === 'INPUT') return;
  ev.preventDefault();
  if (ev.key === 'Escape') { listening = null; renderSettings(); return; }
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(ev.key)) return;
  const next = { ...settings, [listening]: ev.key };
  // A key means one thing, so claiming it clears it from wherever it was.
  for (const [action] of BINDINGS) {
    if (action !== listening && settings[action] === ev.key) next[action] = '';
  }
  settings = next;
  listening = null;
  await chrome.storage.sync.set(next);
  renderSettings();
}, true);

const init = async () => {
  settings = await chrome.storage.sync.get(DEFAULTS);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab ? tab.id : null;
  await refresh();
  // Cross-frame video reports arrive after the first sweep, so take one more look.
  setTimeout(refresh, 350);
};

init();
