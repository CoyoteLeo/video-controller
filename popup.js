const MSG_TAG = '__video_controller_v1__';
const AVAILABILITY_TIMEOUT_MS = 300;

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

const ACTIONS = ['forward', 'backward', 'volumeUp', 'volumeDown', 'theater', 'playPause', 'mute', 'pip'];

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
  $('blockDomains').value = (state.disabledDomains || []).join('\n');
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
    disabledDomains: parseDomains($('blockDomains').value),
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

// The popup has no permission that would let it read the tab's hostname, so it
// asks the content script — which has location.hostname for free — whether the
// extension is enabled here. No reply means no content script is running, which
// is a different answer from "blocked" and must not be reported as one.
const askAvailability = (tabId) => new Promise((resolve) => {
  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    resolve(value);
  };
  setTimeout(() => finish('unavailable'), AVAILABILITY_TIMEOUT_MS);
  try {
    chrome.runtime.lastError;
    chrome.tabs.sendMessage(tabId, { tag: MSG_TAG, type: 'availability' }, (reply) => {
      if (chrome.runtime.lastError || !reply) return finish('unavailable');
      return finish(reply.enabled ? 'enabled' : 'disabled-here');
    });
  } catch (_) {
    finish('unavailable');
  }
});

const setupPanelButton = async () => {
  const btn = $('openPanel');
  const note = $('panelNote');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    btn.textContent = 'Control panel unavailable';
    note.textContent = '';
    return;
  }

  const state = await askAvailability(tab.id);
  if (state === 'enabled') {
    btn.textContent = 'Open control panel';
    btn.disabled = false;
    note.textContent = '';
    btn.addEventListener('click', () => {
      chrome.tabs.sendMessage(tab.id, { tag: MSG_TAG, type: 'open-panel' }, () => {
        void chrome.runtime.lastError;
        window.close();
      });
    });
    return;
  }
  if (state === 'disabled-here') {
    btn.textContent = 'Disabled on this site';
    note.textContent = 'This domain is in the block list below. Remove it to use the panel here.';
    return;
  }
  btn.textContent = 'Not available on this page';
  note.textContent = 'Video Controller does not run on browser pages or the Chrome Web Store.';
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

  setupPanelButton();

  document.addEventListener('keydown', onKeyCapture, true);
  $('saveBtn').addEventListener('click', save);
  $('resetBtn').addEventListener('click', reset);
};

init();
