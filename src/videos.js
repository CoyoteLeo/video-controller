(() => {
  const VC = (globalThis.__videoController ??= {});

  const MSG_TAG = '__video_controller_v1__';
  const isTop = window === window.top;

  let hasDescendantVideo = false;
  let ancestorHasVideo = false;

  // main.js owns what an action means; routing does not get to know.
  let onAction = () => {};
  const init = (opts) => { onAction = opts.onAction; };

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

  const broadcastActionToFrames = (action, exceptSource) => {
    const frames = window.frames;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i] === exceptSource) continue;
      try { frames[i].postMessage({ tag: MSG_TAG, type: 'action', action }, '*'); } catch (_) { /* cross-origin */ }
    }
  };

  const bubble = (action) => {
    if (isTop) return false;
    try {
      window.parent.postMessage({ tag: MSG_TAG, type: 'action-bubble', action }, '*');
      return true;
    } catch (_) {
      return false;
    }
  };

  const routeLocally = (action, exceptSource) => {
    const video = pickVideo();
    if (video) {
      onAction(action, video);
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

  // Installed by main.js rather than at load time, so no module body touches
  // the DOM while the files are still loading.
  const start = () => {
    window.addEventListener('message', onMessage, false);
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
        VC.presentation.tryAutoTheater(v);
        if (announcedToDescendants) topVideoObserver.disconnect();
      });
      topVideoObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    // Ask the parent if it (or any ancestor / sibling subtree) has a video,
    // so we know to bubble keys up even though our own frame has none.
    if (!isTop) {
      try { window.parent.postMessage({ tag: MSG_TAG, type: 'hello' }, '*'); } catch (_) { /* cross-origin */ }
    }
  };

  const onMessage = (e) => {
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
      if (VC.settings.isDisabledHere()) return;
      routeLocally(data.action, e.source);
      return;
    }

    if (data.type === 'action-bubble') {
      if (VC.settings.isDisabledHere()) return;
      if (routeLocally(data.action, e.source)) return;
      bubble(data.action);
    }
  };

  VC.videos = { init, start, pick: pickVideo, routeLocally, bubble,
    hasAncestorVideo: () => ancestorHasVideo, announceIfVideoFound };
})();
