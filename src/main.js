(() => {
  const VC = (globalThis.__videoController ??= {});

  const VOLUME_STEP = 0.1;
  const MSG_TAG = '__video_controller_v1__';
  const isTop = window === window.top;

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
    const s = VC.settings.read();
    if (eventMatches(e, s.forward)) return 'forward';
    if (eventMatches(e, s.backward)) return 'backward';
    if (eventMatches(e, s.volumeUp)) return 'volumeUp';
    if (eventMatches(e, s.volumeDown)) return 'volumeDown';
    if (eventMatches(e, s.theater)) return 'theater';
    if (eventMatches(e, s.playPause)) return 'playPause';
    if (eventMatches(e, s.mute)) return 'mute';
    if (eventMatches(e, s.pip)) return 'pip';
    return null;
  };

  const METADATA_TIMEOUT_MS = 3000;

  // MSE players (blob: src) sit at HAVE_NOTHING until playback starts, and
  // Chrome refuses picture-in-picture on a video with no metadata. Starting
  // playback loads it well inside the keydown's transient activation window.
  const metadataReady = (video) => {
    if (video.readyState > 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('metadata timeout')), METADATA_TIMEOUT_MS);
      video.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolve(); }, { once: true });
      video.play().catch(reject);
    });
  };

  const togglePip = (video) => {
    if (!document.pictureInPictureEnabled) {
      VC.toast.showToast('⚠️ PiP unavailable');
      return;
    }
    if (document.pictureInPictureElement === video) {
      document.exitPictureInPicture().then(
        () => VC.toast.showToast('PiP off'),
        () => VC.toast.showToast('⚠️ PiP exit failed'),
      );
      return;
    }
    // Sites opt out by marking the element; the attribute owns that flag, so
    // clearing it is enough for the IDL property to follow.
    video.removeAttribute('disablePictureInPicture');
    if (VC.presentation.isTheaterActive()) VC.presentation.leaveTheater();
    metadataReady(video)
      .then(() => video.requestPictureInPicture())
      .then(
        () => VC.toast.showToast('🖼️ Picture in picture'),
        () => VC.toast.showToast('⚠️ PiP blocked'),
      );
  };

  const performAction = (action, video) => {
    const step = VC.settings.read().seekSeconds;
    if (action === 'forward') {
      video.currentTime = clamp(video.currentTime + step, 0, video.duration || Infinity);
      VC.toast.showToast(`⏩ +${step}s  (${formatTime(video.currentTime)})`);
    } else if (action === 'backward') {
      video.currentTime = clamp(video.currentTime - step, 0, video.duration || Infinity);
      VC.toast.showToast(`⏪ -${step}s  (${formatTime(video.currentTime)})`);
    } else if (action === 'volumeUp') {
      video.muted = false;
      video.volume = clamp(video.volume + VOLUME_STEP, 0, 1);
      VC.toast.showToast(`🔊 ${Math.round(video.volume * 100)}%`);
    } else if (action === 'volumeDown') {
      video.volume = clamp(video.volume - VOLUME_STEP, 0, 1);
      VC.toast.showToast(`🔉 ${Math.round(video.volume * 100)}%`);
    } else if (action === 'theater') {
      VC.presentation.toggleTheater(video);
    } else if (action === 'pip') {
      togglePip(video);
    } else if (action === 'playPause') {
      if (video.paused || video.ended) {
        const p = video.play();
        if (p && typeof p.then === 'function') {
          p.then(() => VC.toast.showToast('▶️ Play')).catch(() => VC.toast.showToast('⚠️ Play blocked'));
        } else {
          VC.toast.showToast('▶️ Play');
        }
      } else {
        video.pause();
        VC.toast.showToast('⏸️ Pause');
      }
    } else if (action === 'mute') {
      video.muted = !video.muted;
      VC.toast.showToast(video.muted ? '🔇 Muted' : `🔊 ${Math.round(video.volume * 100)}%`);
    }
  };

  const handler = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;

    if ((e.key === 'Escape' || e.code === 'Escape') && VC.presentation.isTheaterActive()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      VC.presentation.leaveTheater();
      return;
    }

    if (VC.settings.isDisabledHere()) return;

    const action = matchAction(e);
    if (!action) return;

    // dispatch sends targeted when a video has been picked by hand, so the
    // existing shortcuts follow the pick instead of the heuristic.
    if (VC.videos.dispatch(action)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };

  const onAnyVideoPlay = (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement)) return;
    VC.videos.announceIfVideoFound();
    VC.presentation.tryAutoTheater(v);
  };

  const siteDefaults = () => ({
    ...VC.transform.DEFAULT_EFFECTS, rate: 1, loop: false,
  });

  const remember = (key, value) => VC.settings.setSiteValue(key, value, siteDefaults());

  const applyRemembered = () => {
    if (VC.settings.isDisabledHere()) return;
    const stored = VC.settings.readSite(siteDefaults());
    const { rotate, flipX, flipY, zoom, pan } = stored;
    VC.presentation.apply({ rotate, flipX, flipY, zoom, pan });
    const v = VC.videos.pick();
    if (!v) return;
    if (stored.rate !== 1) VC.playback.setRate(v, stored.rate);
    if (stored.loop) VC.playback.setLoop(v, true);
  };

  // The panel lives in the extension's own document, so it needs the page's
  // state handed to it: what is applied right now, what videos exist, and
  // whether this domain is blocked (it cannot read the hostname itself).
  // The video may live in a child frame, so the panel's picture of the page comes
  // from the cross-frame sweep rather than from this frame's own video. On an
  // iframe player the top frame has no video at all, which is most of the sites
  // this extension exists for.
  const currentEntry = () => {
    const list = VC.videos.known();
    if (!list.length) return null;
    const picked = VC.videos.pickedId();
    return list.find((i) => i.id === picked)
      || list.find((i) => i.playing)
      || list.reduce((best, i) => (i.width * i.height > best.width * best.height ? i : best), list[0]);
  };

  const snapshot = () => {
    const entry = currentEntry();
    // A report crosses a frame boundary, so treat its shape as untrusted: a frame
    // running older code, or a report that raced, must not hand the panel an
    // undefined effects object to dereference.
    return {
      enabled: !VC.settings.isDisabledHere(),
      hasVideo: !!entry,
      effects: (entry && entry.effects) || VC.presentation.current(),
      rate: (entry && entry.rate) || 1,
      loop: !!(entry && entry.loop),
      ab: (entry && entry.ab) || null,
      videos: VC.videos.known(),
      picked: VC.videos.pickedId(),
      siteCount: VC.settings.siteCount(),
    };
  };

  const applyEffect = (patch) => {
    VC.presentation.apply(patch);
    const e = VC.presentation.current();
    for (const key of Object.keys(patch)) remember(key, e[key]);
  };

  let abPoints = { a: null, b: null };

  const commands = {
    effect: (msg) => applyEffect(msg.patch),
    rate: (msg, v) => { if (v) remember('rate', VC.playback.setRate(v, msg.value)); },
    loop: (_msg, v) => { if (v) { VC.playback.setLoop(v, !v.loop); remember('loop', v.loop); } },
    ab: (msg, v) => {
      if (!v) return;
      if (msg.point === 'clear') { abPoints = { a: null, b: null }; VC.playback.clearRepeat(); return; }
      abPoints = { ...abPoints, [msg.point]: v.currentTime };
      VC.playback.setRepeat(v, abPoints.a, abPoints.b);
    },
    frame: (msg, v) => { if (v) VC.playback.stepFrames(v, msg.frames, msg.fps); },
    theater: (_msg, v) => { if (v) VC.presentation.toggleTheater(v); },
    pip: (_msg, v) => { if (v) togglePip(v); },
    reset: (_msg, v) => {
      VC.presentation.reset();
      if (v) { VC.playback.setRate(v, 1); VC.playback.setLoop(v, false); }
      VC.playback.clearRepeat();
      abPoints = { a: null, b: null };
    },
  };

  // One table for both entry points: a keyboard shortcut and a panel command are
  // the same thing arriving by different doors, and both are delivered to
  // whichever frame owns the video.
  const runCommand = (name, video, payload) => {
    const run = commands[name];
    if (run) run(payload || {}, video);
    else performAction(name, video);
  };

  // These are the top frame's own business, not the video-owning frame's.
  const LOCAL_ONLY = new Set(['pick', 'refresh', 'forget']);

  const runLocal = (msg) => {
    if (msg.name === 'pick') return VC.videos.setPicked(msg.id);
    if (msg.name === 'refresh') return VC.videos.list(() => {});
    // Forget clears this frame's stored profile, then asks whichever frame owns
    // the video to drop what is applied.
    VC.settings.clearSite();
    return VC.videos.dispatch('reset', {});
  };

  if (isTop) {
    chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
      if (!msg || msg.tag !== MSG_TAG) return undefined;

      if (msg.type === 'state') {
        // Answer with what the last sweep found, then start the next one. Asking
        // first would read the list before any frame has had time to reply.
        respond(snapshot());
        if (!VC.settings.isDisabledHere()) VC.videos.list(() => {});
        return true;
      }

      if (msg.type === 'command') {
        // One gate for everything: a blocked domain runs no command and writes
        // no per-site memory.
        if (!VC.settings.isDisabledHere()) {
          if (LOCAL_ONLY.has(msg.name)) runLocal(msg);
          else VC.videos.dispatch(msg.name, msg);
        }
        respond(snapshot());
        return true;
      }

      return undefined;
    });
  }

  VC.videos.init({ onAction: runCommand });
  VC.videos.start();
  VC.settings.prime(chrome.storage, () => {
    VC.videos.announceIfVideoFound();
    applyRemembered();
    const v = VC.videos.pick();
    if (v && !v.paused && !v.ended) VC.presentation.tryAutoTheater(v);
  });

  document.addEventListener('play', onAnyVideoPlay, true);
  window.addEventListener('keydown', handler, true);
})();
