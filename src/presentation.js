(() => {
  const VC = (globalThis.__videoController ??= {});

  const DEFAULTS = VC.transform.DEFAULT_EFFECTS;

  let effects = DEFAULTS;

  // Everything we changed, in one place. Theater and the transforms used to keep
  // separate copies of "the original value", which is how they end up disagreeing.
  let take = null;

  const isDefault = (e) =>
    e.rotate === DEFAULTS.rotate && e.flipX === DEFAULTS.flipX && e.flipY === DEFAULTS.flipY
    && e.zoom === DEFAULTS.zoom && e.pan.x === 0 && e.pan.y === 0 && e.theater === DEFAULTS.theater;

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

  const captureStyle = (el) => el.getAttribute('style');

  // Touching el.style at all materialises a style attribute, and CSSOM leaves an
  // empty one behind after the last property is removed. An element that started
  // without the attribute has to end without it, so this is the one place that
  // decides what "no inline style" means.
  const restoreStyle = (el, original) => {
    if (original !== null) {
      el.setAttribute('style', original);
      return;
    }
    el.removeAttribute('style');
    if (el.getAttribute('style') === '') el.removeAttribute('style');
  };

  const open = (video) => ({
    video,
    container: pickPlayerContainer(video),
    originalVideoStyle: captureStyle(video),
    originalContainerStyle: null,
    originalRootOverflow: document.documentElement.style.overflow,
    clipped: [],
    theaterOn: false,
    backdrop: null,
    placeholder: null,
    closeBtn: null,
  });

  const fix = (el, props) => {
    for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v, 'important');
  };

  const enterTheater = () => {
    const { video, container } = take;
    take.originalContainerStyle = captureStyle(container);

    const placeholder = document.createComment('video-controller-theater-placeholder');
    if (container.parentNode) {
      container.parentNode.insertBefore(placeholder, container);
      document.documentElement.appendChild(container);
    }
    take.placeholder = placeholder;

    const backdrop = document.createElement('div');
    backdrop.id = '__video_optimizer_backdrop__';
    backdrop.style.cssText = 'position:fixed;inset:0;background:#000;z-index:2147483645';
    backdrop.addEventListener('click', () => apply({ theater: false }));
    document.documentElement.insertBefore(backdrop, container);
    take.backdrop = backdrop;

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
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); apply({ theater: false }); });
    document.documentElement.appendChild(closeBtn);
    take.closeBtn = closeBtn;

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
    take.theaterOn = true;
  };

  const leaveTheater = () => {
    const { container, video, placeholder, backdrop, closeBtn } = take;
    // Both style attributes go back to their captured values, which also wipes
    // any transform — render() writes the transform again afterwards.
    if (container) restoreStyle(container, take.originalContainerStyle);
    if (video) restoreStyle(video, take.originalVideoStyle);
    if (placeholder && placeholder.parentNode && container) {
      placeholder.parentNode.insertBefore(container, placeholder);
      placeholder.remove();
    }
    if (backdrop) backdrop.remove();
    if (closeBtn) closeBtn.remove();
    document.documentElement.style.overflow = take.originalRootOverflow || '';
    take.placeholder = null;
    take.backdrop = null;
    take.closeBtn = null;
    take.originalContainerStyle = null;
    take.theaterOn = false;
  };

  // A rotated or zoomed video overflows its box, and any ancestor that clips has
  // to be opened up. Each one's own inline value is recorded, so releasing puts
  // back "no inline overflow at all" rather than writing `visible` over it.
  const releaseClips = () => {
    for (const { el, value, priority, hadAttr } of take.clipped) {
      if (value) el.style.setProperty('overflow', value, priority);
      else el.style.removeProperty('overflow');
      // removeProperty leaves an empty style="" behind. An element that had no
      // style attribute at all must not gain one, or the page does not come back
      // byte-for-byte and selectors like :not([style]) change meaning.
      if (!hadAttr && !el.getAttribute('style')) el.removeAttribute('style');
    }
    take.clipped = [];
  };

  const openClips = () => {
    if (take.clipped.length) return;
    let el = take.video.parentElement;
    while (el && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        take.clipped.push({
          el,
          value: el.style.getPropertyValue('overflow'),
          priority: el.style.getPropertyPriority('overflow'),
          hadAttr: el.hasAttribute('style'),
        });
        el.style.setProperty('overflow', 'visible', 'important');
      }
      el = el.parentElement;
    }
  };

  const geometryOf = (video) => {
    const box = (video.parentElement || video).getBoundingClientRect();
    return {
      videoWidth: video.clientWidth,
      videoHeight: video.clientHeight,
      boxWidth: box.width,
      boxHeight: box.height,
    };
  };

  const render = () => {
    if (!take) return;
    if (effects.theater && !take.theaterOn) enterTheater();
    else if (!effects.theater && take.theaterOn) leaveTheater();

    const { transform } = VC.transform.toCss(effects, geometryOf(take.video));
    if (transform) {
      take.video.style.setProperty('transform', transform, 'important');
      openClips();
    } else {
      take.video.style.removeProperty('transform');
      if (take.originalVideoStyle === null && !take.video.getAttribute('style')) {
        take.video.removeAttribute('style');
      }
      releaseClips();
    }
  };

  const restore = () => {
    if (!take) return;
    if (take.theaterOn) leaveTheater();
    releaseClips();
    restoreStyle(take.video, take.originalVideoStyle);
    if (take.originalVideoStyle === null && take.video.getAttribute('style') === '') {
      take.video.removeAttribute('style');
    }
    take = null;
  };

  function apply(patch, video) {
    const before = effects;
    const next = { ...effects, ...patch, pan: { ...effects.pan, ...(patch.pan || {}) } };
    effects = next;

    if (isDefault(next)) {
      restore();
    } else {
      if (!take) {
        const target = video || VC.videos.pick();
        if (!target) { effects = before; return; }
        take = open(target);
      }
      render();
    }

    if (next.theater !== before.theater) {
      VC.toast.showToast(next.theater ? '🎬 Theater mode' : 'Theater off');
    }
  }

  const reset = () => apply({ ...DEFAULTS, pan: { x: 0, y: 0 } });

  const toggleTheater = (video) => apply({ theater: !effects.theater }, video);

  let autoTheaterDone = false;

  const tryAutoTheater = (video) => {
    if (autoTheaterDone || effects.theater) return;
    if (VC.settings.isDisabledHere()) return;
    if (!VC.settings.shouldAutoTheater()) return;
    const v = video || VC.videos.pick();
    if (!v) return;
    autoTheaterDone = true;
    apply({ theater: true }, v);
  };

  VC.presentation = {
    apply,
    reset,
    current: () => effects,
    toggleTheater,
    leaveTheater: () => apply({ theater: false }),
    isTheaterActive: () => effects.theater,
    tryAutoTheater,
  };
})();
