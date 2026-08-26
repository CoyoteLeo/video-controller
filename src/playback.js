(() => {
  const VC = (globalThis.__videoController ??= {});

  // Chrome throws outside this range rather than clamping for us.
  const RATE_MIN = 0.0625;
  const RATE_MAX = 16;

  // The API does not expose a video's frame rate, so stepping is an
  // approximation and the panel says so.
  const DEFAULT_FPS = 30;

  const clampRate = (rate) => {
    if (!Number.isFinite(rate)) return 1;
    return Math.min(RATE_MAX, Math.max(RATE_MIN, rate));
  };

  const setRate = (video, rate) => {
    const clamped = clampRate(rate);
    video.playbackRate = clamped;
    return clamped;
  };

  const setLoop = (video, on) => { video.loop = on; };

  let repeat = null;

  const clearRepeat = () => {
    if (!repeat) return;
    repeat.video.removeEventListener('timeupdate', repeat.onTimeUpdate);
    repeat = null;
  };

  // Both points are required: a half-set range has nothing to repeat, so it
  // leaves no listener attached rather than sitting dormant.
  const setRepeat = (video, a, b) => {
    clearRepeat();
    if (a === null || b === null || !(b > a)) return null;
    const onTimeUpdate = () => {
      if (video.currentTime >= b) video.currentTime = a;
    };
    video.addEventListener('timeupdate', onTimeUpdate);
    repeat = { video, a, b, onTimeUpdate };
    return { a, b };
  };

  const currentRepeat = () => (repeat ? { a: repeat.a, b: repeat.b } : null);

  const stepFrames = (video, frames, fps = DEFAULT_FPS) => {
    video.pause();
    const next = video.currentTime + frames / fps;
    const limit = Number.isFinite(video.duration) ? video.duration : Infinity;
    video.currentTime = Math.min(limit, Math.max(0, next));
  };

  VC.playback = {
    RATE_MIN, RATE_MAX, DEFAULT_FPS,
    clampRate, setRate, setLoop,
    setRepeat, clearRepeat, currentRepeat,
    stepFrames,
  };
})();
