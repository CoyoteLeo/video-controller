(() => {
  const VC = (globalThis.__videoController ??= {});

  const DEFAULT_EFFECTS = Object.freeze({
    rotate: 0, flipX: false, flipY: false, zoom: 1,
    pan: Object.freeze({ x: 0, y: 0 }), theater: false,
  });

  const rotatedBox = (w, h, deg) => {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    return { w: w * cos + h * sin, h: w * sin + h * cos };
  };

  const fitScale = (effects, geometry) => {
    const { videoWidth: w, videoHeight: h, boxWidth, boxHeight } = geometry;
    if (!(w > 0 && h > 0 && boxWidth > 0 && boxHeight > 0)) return 1;
    const box = rotatedBox(w, h, effects.rotate);
    const fit = Math.min(1, boxWidth / box.w, boxHeight / box.h);
    return Math.abs(fit - 1) < 1e-9 ? 1 : fit;
  };

  const toCss = (effects, geometry) => {
    const scaleCorrection = fitScale(effects, geometry);
    const magnitude = effects.zoom * scaleCorrection;
    const sx = effects.flipX ? -magnitude : magnitude;
    const sy = effects.flipY ? -magnitude : magnitude;

    const parts = [];
    if (effects.pan.x || effects.pan.y) parts.push(`translate(${effects.pan.x}px, ${effects.pan.y}px)`);
    if (effects.rotate) parts.push(`rotate(${effects.rotate}deg)`);
    if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`);

    return { transform: parts.join(' '), scaleCorrection };
  };

  VC.transform = { DEFAULT_EFFECTS, toCss };
})();
