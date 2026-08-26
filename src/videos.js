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
      onAction(action, video, undefined);
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
  // ---- video identity ----------------------------------------------------
  // Ids must be unique across the whole frame tree, so a frame-local index will
  // not do. crypto.randomUUID() is secure-context-only and this runs on
  // <all_urls>, so the salt comes from getRandomValues, which has no such limit.
  const salt = (() => {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return `${buf[0].toString(36)}${buf[1].toString(36)}`;
  })();
  let counter = 0;
  const ids = new WeakMap();

  const idOf = (el) => {
    let id = ids.get(el);
    if (!id) {
      id = `${salt}-${counter++}`;
      ids.set(el, id);
    }
    return id;
  };

  const localVideos = () => Array.from(document.querySelectorAll('video'));

  const findById = (id) => localVideos().find((el) => ids.get(el) === id) || null;

  const describe = (el) => ({
    id: idOf(el),
    width: el.clientWidth,
    height: el.clientHeight,
    duration: Number.isFinite(el.duration) ? el.duration : 0,
    playing: !el.paused && !el.ended,
    frame: !isTop,
  });

  // ---- manual pick -------------------------------------------------------
  // Held in memory only. A stored element id would mean nothing on the next
  // page load, so this is never persisted.
  let pickedId = null;
  let pickedWatcher = null;

  const watchPicked = (el) => {
    if (pickedWatcher) pickedWatcher.disconnect();
    pickedWatcher = new MutationObserver(() => {
      if (el.isConnected) return;
      pickedWatcher.disconnect();
      pickedWatcher = null;
      // Straight to the top: it is the only frame that cares, and it is
      // reachable from any depth even across origins.
      try { window.top.postMessage({ tag: MSG_TAG, type: 'pick-lost', id: idOf(el) }, '*'); } catch (_) { /* cross-origin */ }
    });
    pickedWatcher.observe(document.documentElement, { childList: true, subtree: true });
  };

  const broadcast = (payload, exceptSource) => {
    const frames = window.frames;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i] === exceptSource) continue;
      try { frames[i].postMessage({ tag: MSG_TAG, ...payload }, '*'); } catch (_) { /* cross-origin */ }
    }
  };

  const toParent = (payload) => {
    if (isTop) return false;
    try { window.parent.postMessage({ tag: MSG_TAG, ...payload }, '*'); return true; } catch (_) { return false; }
  };

  const applyPick = (id, exceptSource) => {
    pickedId = id;
    const own = id ? findById(id) : null;
    if (own) watchPicked(own);
    broadcast({ type: 'pick-set', id }, exceptSource);
  };

  const setPicked = (id) => applyPick(id, null);

  // ---- listing -----------------------------------------------------------
  let listCallback = null;
  let collected = [];

  const list = (cb) => {
    listCallback = cb;
    collected = localVideos().map(describe);
    cb(collected);
    broadcast({ type: 'list-request' });
  };

  // What the last sweep turned up. The panel polls, so it reads whatever has
  // arrived rather than waiting for frames that may never answer.
  const known = () => collected;

  const addReports = (items) => {
    const seen = new Set(collected.map((i) => i.id));
    collected = collected.concat(items.filter((i) => !seen.has(i.id)));
    // Reports trickle in and a cross-origin frame may never answer, so the
    // caller gets what has arrived so far rather than waiting for the tree.
    if (listCallback) listCallback(collected);
  };

  // ---- targeted routing --------------------------------------------------
  // Deliberately not routed through routeLocally. Its stopping rule is "this
  // frame has a video, so act and stop", which is right for an untargeted
  // action and wrong here: a frame holding some other video must pass the
  // message on, not consume it.
  const deliverTargeted = (msg, source) => {
    const own = findById(msg.target);
    if (own) {
      onAction(msg.action, own, msg.payload);
      return;
    }
    broadcast({ type: 'action', action: msg.action, payload: msg.payload, target: msg.target }, source);
    if (window.parent !== source) toParent({ type: 'action', action: msg.action, payload: msg.payload, target: msg.target });
  };

  const dispatch = (action, payload) => {
    if (pickedId) {
      deliverTargeted({ action, payload, target: pickedId }, null);
      return true;
    }
    if (routeLocally(action, null)) return true;
    return ancestorHasVideo && bubble(action);
  };

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

    if (data.type === 'pick-set') {
      if (VC.settings.isDisabledHere()) return;
      applyPick(data.id, e.source);
      return;
    }

    if (data.type === 'pick-lost') {
      if (VC.settings.isDisabledHere()) return;
      if (isTop && data.id === pickedId) applyPick(null, null);
      return;
    }

    if (data.type === 'list-request') {
      if (VC.settings.isDisabledHere()) return;
      broadcast({ type: 'list-request' }, e.source);
      toParent({ type: 'list-report', items: localVideos().map(describe) });
      return;
    }

    if (data.type === 'list-report') {
      if (VC.settings.isDisabledHere()) return;
      if (isTop) addReports(data.items || []);
      else toParent({ type: 'list-report', items: data.items || [] });
      return;
    }

    if (data.type === 'action') {
      if (VC.settings.isDisabledHere()) return;
      if (data.target) deliverTargeted(data, e.source);
      else routeLocally(data.action, e.source);
      return;
    }

    if (data.type === 'action-bubble') {
      if (VC.settings.isDisabledHere()) return;
      if (routeLocally(data.action, e.source)) return;
      bubble(data.action);
    }
  };

  VC.videos = {
    init, start, pick: pickVideo, routeLocally, bubble, dispatch,
    hasAncestorVideo: () => ancestorHasVideo, announceIfVideoFound,
    list, known, setPicked, pickedId: () => pickedId, findById,
  };
})();
