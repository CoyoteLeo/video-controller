(() => {
  const DEFAULTS = {
    forward: 'ArrowRight',
    backward: 'ArrowLeft',
    volumeUp: 'ArrowUp',
    volumeDown: 'ArrowDown',
    theater: 't',
    playPause: ' ',
    mute: 'm',
    seekSeconds: 5,
    autoTheaterDomains: [],
    disabledDomains: ['netflix.com', 'youtube.com'],
  };
  const VOLUME_STEP = 0.1;
  const MSG_TAG = '__video_controller_v1__';
  const isTop = window === window.top;

  let settings = { ...DEFAULTS };
  let hasDescendantVideo = false;
  let ancestorHasVideo = false;

  const pickVideo = () => {
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return null;
    const playing = videos.find((v) => !v.paused && !v.ended);
    if (playing) return playing;
    return videos.reduce((best, v) => {
      const area = (v.clientWidth || 0) * (v.clientHeight || 0);
      const bestArea = best ? (best.clientWidth || 0) * (best.clientHeight || 0) : -1;
      return area > bestArea ? v : best;
    }, null);
  };

  // Only inputs that accept typed text should suppress shortcuts. Non-text
  // controls like a player's <input type="range"> seek bar grab focus when
  // clicked, but typing into them is meaningless — keep shortcuts working.
  const TEXT_INPUT_TYPES = new Set([
    'text', 'search', 'email', 'url', 'tel', 'password', 'number',
    'date', 'datetime-local', 'month', 'week', 'time',
  ]);

  const isTypingTarget = (el) => {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return TEXT_INPUT_TYPES.has((el.type || 'text').toLowerCase());
    if (el.isContentEditable) return true;
    return false;
  };

  let toastEl = null;
  let toastTimer = null;
  const showToast = (text) => {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = [
        'position:fixed',
        'top:20px',
        'left:50%',
        'transform:translateX(-50%)',
        'padding:8px 14px',
        'background:rgba(0,0,0,0.72)',
        'color:#fff',
        'font:600 14px/1.2 -apple-system,system-ui,sans-serif',
        'border-radius:6px',
        'z-index:2147483647',
        'pointer-events:none',
        'transition:opacity 0.2s',
      ].join(';');
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl) toastEl.style.opacity = '0';
    }, 900);
  };

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  const formatTime = (s) => {
    if (!isFinite(s)) return '--:--';
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  };

  const keyEq = (a, b) => {
    if (!a || !b) return false;
    if (a.length === 1 && b.length === 1) return a.toLowerCase() === b.toLowerCase();
    return a === b;
  };

  // Derive a key string from KeyboardEvent.code so shortcuts work under IMEs
  // (e.g., Chinese/Japanese), where e.key reports "Process" for letters/space.
  const keyFromCode = (code) => {
    if (!code) return null;
    if (code.length === 4 && code.startsWith('Key')) return code.slice(3).toLowerCase();
    if (code.length === 6 && code.startsWith('Digit')) return code.slice(5);
    if (code === 'Space') return ' ';
    if (code.startsWith('Arrow')) return code;
    if (code === 'Escape') return 'Escape';
    return null;
  };

  const eventMatches = (e, target) => {
    if (keyEq(e.key, target)) return true;
    const fromCode = keyFromCode(e.code);
    return fromCode ? keyEq(fromCode, target) : false;
  };

  const matchAction = (e) => {
    if (eventMatches(e, settings.forward)) return 'forward';
    if (eventMatches(e, settings.backward)) return 'backward';
    if (eventMatches(e, settings.volumeUp)) return 'volumeUp';
    if (eventMatches(e, settings.volumeDown)) return 'volumeDown';
    if (eventMatches(e, settings.theater)) return 'theater';
    if (eventMatches(e, settings.playPause)) return 'playPause';
    if (eventMatches(e, settings.mute)) return 'mute';
    return null;
  };

  const theater = {
    active: false,
    container: null,
    video: null,
    originalContainerStyle: '',
    originalVideoStyle: '',
    originalOverflow: '',
    backdrop: null,
    placeholder: null,
    closeBtn: null,
  };

  const PLAYER_CLASS_RE = /\b(plyr|player|jwplayer|vjs|jw-player|video-js|video-player|videoplayer|html5-video-player)\b/i;

  const isPlayerLike = (el) => {
    const cls = typeof el.className === 'string' ? el.className : '';
    const id = el.id || '';
    return PLAYER_CLASS_RE.test(cls) || PLAYER_CLASS_RE.test(id);
  };

  const pickPlayerContainer = (video) => {
    const vRect = video.getBoundingClientRect();
    let el = video.parentElement;
    let firstMatching = null;
    let bestPlayerLike = null;
    while (el && el !== document.body && el !== document.documentElement) {
      const r = el.getBoundingClientRect();
      const matches = r.width >= vRect.width - 2 && r.height >= vRect.height - 2;
      if (!matches) break;
      if (!firstMatching) firstMatching = el;
      if (isPlayerLike(el)) bestPlayerLike = el;
      el = el.parentElement;
    }
    return bestPlayerLike || firstMatching || video.parentElement || video;
  };

  const enter = (video) => {
    if (theater.active) return;
    const container = pickPlayerContainer(video);
    theater.video = video;
    theater.container = container;
    theater.originalContainerStyle = container.getAttribute('style') || '';
    theater.originalVideoStyle = video.getAttribute('style') || '';
    theater.originalOverflow = document.documentElement.style.overflow;

    const placeholder = document.createComment('video-controller-theater-placeholder');
    if (container.parentNode) {
      container.parentNode.insertBefore(placeholder, container);
      document.documentElement.appendChild(container);
    }
    theater.placeholder = placeholder;

    const backdrop = document.createElement('div');
    backdrop.id = '__video_optimizer_backdrop__';
    backdrop.style.cssText = 'position:fixed;inset:0;background:#000;z-index:2147483645';
    backdrop.addEventListener('click', exit);
    document.documentElement.insertBefore(backdrop, container);
    theater.backdrop = backdrop;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Exit theater mode');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = [
      'position:fixed',
      'top:12px',
      'right:12px',
      'width:36px',
      'height:36px',
      'padding:0',
      'border:0',
      'border-radius:50%',
      'background:rgba(0,0,0,0.55)',
      'color:#fff',
      'font:600 18px/1 -apple-system,system-ui,sans-serif',
      'cursor:pointer',
      'opacity:0.85',
      'z-index:2147483647',
      'display:flex',
      'align-items:center',
      'justify-content:center',
    ].join(';');
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); exit(); });
    document.documentElement.appendChild(closeBtn);
    theater.closeBtn = closeBtn;

    const fix = (el, props) => {
      for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v, 'important');
    };
    fix(container, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      'max-width': '100vw',
      'max-height': '100vh',
      margin: '0',
      padding: '0',
      background: '#000',
      'z-index': '2147483646',
    });
    fix(video, {
      width: '100%',
      height: '100%',
      'max-width': '100%',
      'max-height': '100%',
      'object-fit': 'contain',
      background: '#000',
    });

    document.documentElement.style.overflow = 'hidden';
    theater.active = true;
    showToast('🎬 Theater mode');
  };

  function exit() {
    if (!theater.active) return;
    const { container, video, originalContainerStyle, originalVideoStyle, originalOverflow, backdrop, placeholder, closeBtn } = theater;
    if (container) {
      if (originalContainerStyle) container.setAttribute('style', originalContainerStyle);
      else container.removeAttribute('style');
    }
    if (video) {
      if (originalVideoStyle) video.setAttribute('style', originalVideoStyle);
      else video.removeAttribute('style');
    }
    if (placeholder && placeholder.parentNode && container) {
      placeholder.parentNode.insertBefore(container, placeholder);
      placeholder.remove();
    }
    if (backdrop) backdrop.remove();
    if (closeBtn) closeBtn.remove();
    document.documentElement.style.overflow = originalOverflow || '';
    theater.active = false;
    theater.container = null;
    theater.video = null;
    theater.backdrop = null;
    theater.placeholder = null;
    theater.closeBtn = null;
    showToast('Theater off');
  }

  const toggleTheater = (video) => {
    if (theater.active) exit();
    else enter(video);
  };

  const performAction = (action, video) => {
    const step = settings.seekSeconds;
    if (action === 'forward') {
      video.currentTime = clamp(video.currentTime + step, 0, video.duration || Infinity);
      showToast(`⏩ +${step}s  (${formatTime(video.currentTime)})`);
    } else if (action === 'backward') {
      video.currentTime = clamp(video.currentTime - step, 0, video.duration || Infinity);
      showToast(`⏪ -${step}s  (${formatTime(video.currentTime)})`);
    } else if (action === 'volumeUp') {
      video.muted = false;
      video.volume = clamp(video.volume + VOLUME_STEP, 0, 1);
      showToast(`🔊 ${Math.round(video.volume * 100)}%`);
    } else if (action === 'volumeDown') {
      video.volume = clamp(video.volume - VOLUME_STEP, 0, 1);
      showToast(`🔉 ${Math.round(video.volume * 100)}%`);
    } else if (action === 'theater') {
      toggleTheater(video);
    } else if (action === 'playPause') {
      if (video.paused || video.ended) {
        const p = video.play();
        if (p && typeof p.then === 'function') {
          p.then(() => showToast('▶️ Play')).catch(() => showToast('⚠️ Play blocked'));
        } else {
          showToast('▶️ Play');
        }
      } else {
        video.pause();
        showToast('⏸️ Pause');
      }
    } else if (action === 'mute') {
      video.muted = !video.muted;
      showToast(video.muted ? '🔇 Muted' : `🔊 ${Math.round(video.volume * 100)}%`);
    }
  };

  const broadcastActionToFrames = (action, exceptSource) => {
    const frames = window.frames;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i] === exceptSource) continue;
      try { frames[i].postMessage({ tag: MSG_TAG, type: 'action', action }, '*'); } catch (_) { /* cross-origin */ }
    }
  };

  const bubbleActionToParent = (action) => {
    if (isTop) return false;
    try {
      window.parent.postMessage({ tag: MSG_TAG, type: 'action-bubble', action }, '*');
      return true;
    } catch (_) {
      return false;
    }
  };

  const tryHandleActionLocally = (action, exceptSource) => {
    const video = pickVideo();
    if (video) {
      performAction(action, video);
      return true;
    }
    if (hasDescendantVideo) {
      broadcastActionToFrames(action, exceptSource);
      return true;
    }
    return false;
  };

  const announceAncestorHasVideoToFrames = (exceptSource) => {
    const frames = window.frames;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i] === exceptSource) continue;
      try { frames[i].postMessage({ tag: MSG_TAG, type: 'ancestor-has-video' }, '*'); } catch (_) { /* cross-origin */ }
    }
  };

  const handler = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;

    if ((e.key === 'Escape' || e.code === 'Escape') && theater.active) {
      e.preventDefault();
      e.stopImmediatePropagation();
      exit();
      return;
    }

    if (isDisabledHere()) return;

    const action = matchAction(e);
    if (!action) return;

    if (tryHandleActionLocally(action, null)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    if (ancestorHasVideo && bubbleActionToParent(action)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };

  const hostMatchesDomain = (host, entry) => {
    if (!entry) return false;
    return host === entry || host.endsWith('.' + entry);
  };

  const shouldAutoTheater = () => {
    const host = (location.hostname || '').toLowerCase();
    const list = settings.autoTheaterDomains || [];
    return list.some((entry) => hostMatchesDomain(host, (entry || '').toLowerCase()));
  };

  const isDisabledHere = () => {
    const host = (location.hostname || '').toLowerCase();
    const list = settings.disabledDomains || [];
    return list.some((entry) => hostMatchesDomain(host, (entry || '').toLowerCase()));
  };

  let autoTheaterDone = false;
  const tryAutoTheater = (video) => {
    if (autoTheaterDone || theater.active) return;
    if (isDisabledHere()) return;
    if (!shouldAutoTheater()) return;
    const v = video || pickVideo();
    if (!v) return;
    autoTheaterDone = true;
    enter(v);
  };

  const announceVideoToParent = () => {
    if (isTop) return;
    try { window.parent.postMessage({ tag: MSG_TAG, type: 'has-video' }, '*'); } catch (_) { /* cross-origin */ }
  };

  let announcedToParent = false;
  let announcedToDescendants = false;
  const announceIfVideoFound = () => {
    if (!document.querySelector('video')) return;
    if (!isTop && !announcedToParent) {
      announceVideoToParent();
      announcedToParent = true;
    }
    if (!announcedToDescendants) {
      announceAncestorHasVideoToFrames();
      announcedToDescendants = true;
    }
  };

  const onAnyVideoPlay = (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement)) return;
    announceIfVideoFound();
    tryAutoTheater(v);
  };

  window.addEventListener('message', (e) => {
    const data = e.data;
    if (!data || typeof data !== 'object' || data.tag !== MSG_TAG) return;

    if (data.type === 'has-video') {
      const firstHearing = !hasDescendantVideo;
      hasDescendantVideo = true;
      if (firstHearing && !isTop && !announcedToParent) {
        announceVideoToParent();
        announcedToParent = true;
      }
      // Let the source's siblings know there's a video somewhere in the tree,
      // so they can bubble shortcuts up instead of dropping them.
      announceAncestorHasVideoToFrames(e.source);
      return;
    }

    if (data.type === 'ancestor-has-video') {
      if (ancestorHasVideo) return;
      ancestorHasVideo = true;
      announceAncestorHasVideoToFrames(e.source);
      return;
    }

    if (data.type === 'hello') {
      // A child frame just loaded. If anyone in the tree has a video, let it know.
      if (document.querySelector('video') || hasDescendantVideo || ancestorHasVideo) {
        try { e.source.postMessage({ tag: MSG_TAG, type: 'ancestor-has-video' }, '*'); } catch (_) { /* cross-origin */ }
      }
      return;
    }

    if (data.type === 'action') {
      if (isDisabledHere()) return;
      tryHandleActionLocally(data.action, e.source);
      return;
    }

    if (data.type === 'action-bubble') {
      if (isDisabledHere()) return;
      if (tryHandleActionLocally(data.action, e.source)) return;
      bubbleActionToParent(data.action);
    }
  });

  if (!isTop) {
    const videoObserver = new MutationObserver(() => {
      announceIfVideoFound();
      if (announcedToParent && announcedToDescendants) videoObserver.disconnect();
    });
    videoObserver.observe(document.documentElement, { childList: true, subtree: true });
  } else {
    const topVideoObserver = new MutationObserver(() => {
      announceIfVideoFound();
      const v = pickVideo();
      if (!v) return;
      tryAutoTheater(v);
      if (announcedToDescendants) topVideoObserver.disconnect();
    });
    topVideoObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    settings = { ...settings, ...stored };
    announceIfVideoFound();
    const v = pickVideo();
    if (v && !v.paused && !v.ended) tryAutoTheater(v);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const next = { ...settings };
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in next) next[key] = newValue;
    }
    settings = next;
  });

  document.addEventListener('play', onAnyVideoPlay, true);
  window.addEventListener('keydown', handler, true);

  // Ask the parent if it (or any ancestor / sibling subtree) has a video,
  // so we know to bubble keys up even though our own frame has none.
  if (!isTop) {
    try { window.parent.postMessage({ tag: MSG_TAG, type: 'hello' }, '*'); } catch (_) { /* cross-origin */ }
  }
})();
