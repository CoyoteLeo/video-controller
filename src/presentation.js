(() => {
  const VC = (globalThis.__videoController ??= {});

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
    VC.panel.showToast('🎬 Theater mode');
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
    VC.panel.showToast('Theater off');
  }

  const toggleTheater = (video) => {
    if (theater.active) exit();
    else enter(video);
  };

  let autoTheaterDone = false;

  const tryAutoTheater = (video) => {
    if (autoTheaterDone || theater.active) return;
    if (VC.settings.isDisabledHere()) return;
    if (!VC.settings.shouldAutoTheater()) return;
    const v = video || VC.videos.pick();
    if (!v) return;
    autoTheaterDone = true;
    enter(v);
  };

  VC.presentation = { toggleTheater, leaveTheater: exit, isTheaterActive: () => theater.active,
    tryAutoTheater };
})();
