const DEFAULTS = {
  forward: 'ArrowRight',
  backward: 'ArrowLeft',
  volumeUp: 'ArrowUp',
  volumeDown: 'ArrowDown',
  theater: 't',
  seekSeconds: 5,
  autoTheaterDomains: [],
};

const ACTIONS = ['forward', 'backward', 'volumeUp', 'volumeDown', 'theater'];

const prettyKey = (k) => {
  if (!k) return '—';
  const map = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ' ': 'Space',
    Escape: 'Esc',
  };
  return map[k] || (k.length === 1 ? k.toUpperCase() : k);
};

const normalizeDomain = (raw) => {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return '';
  return s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\./, '');
};

const parseDomains = (text) =>
  Array.from(new Set(
    (text || '').split(/[\r\n,]+/).map(normalizeDomain).filter(Boolean)
  ));

const state = { ...DEFAULTS };
let listeningBtn = null;

const $ = (id) => document.getElementById(id);
const buttons = () => document.querySelectorAll('.key-btn');

const render = () => {
  buttons().forEach((btn) => {
    const action = btn.dataset.action;
    btn.textContent = btn === listeningBtn ? 'Press a key…' : prettyKey(state[action]);
    btn.classList.toggle('listening', btn === listeningBtn);
  });
  $('seekSeconds').value = state.seekSeconds;
  $('autoDomains').value = (state.autoTheaterDomains || []).join('\n');
};

const stopListening = () => {
  listeningBtn = null;
  render();
};

const onKeyCapture = (e) => {
  if (!listeningBtn) return;
  if (e.target && e.target.tagName === 'TEXTAREA') return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') {
    stopListening();
    return;
  }
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
  const action = listeningBtn.dataset.action;
  for (const other of ACTIONS) {
    if (other !== action && state[other] === e.key) state[other] = '';
  }
  state[action] = e.key;
  stopListening();
};

const save = async () => {
  const secs = Number($('seekSeconds').value);
  const next = {
    ...state,
    seekSeconds: Number.isFinite(secs) && secs > 0 ? Math.min(600, Math.floor(secs)) : DEFAULTS.seekSeconds,
    autoTheaterDomains: parseDomains($('autoDomains').value),
  };
  Object.assign(state, next);
  await chrome.storage.sync.set(next);
  const status = $('status');
  status.textContent = 'Saved';
  setTimeout(() => { status.textContent = ''; }, 1200);
  render();
};

const reset = () => {
  Object.assign(state, { ...DEFAULTS });
  render();
};

const init = async () => {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  Object.assign(state, stored);
  render();

  buttons().forEach((btn) => {
    btn.addEventListener('click', () => {
      listeningBtn = listeningBtn === btn ? null : btn;
      render();
    });
  });

  document.addEventListener('keydown', onKeyCapture, true);
  $('saveBtn').addEventListener('click', save);
  $('resetBtn').addEventListener('click', reset);
};

init();
