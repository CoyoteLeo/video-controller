const test = require('node:test');
const assert = require('node:assert');
require('../src/transform.js');
const { toCss, DEFAULT_EFFECTS } = globalThis.__videoController.transform;

const geometry = { videoWidth: 1600, videoHeight: 900, boxWidth: 1600, boxHeight: 900 };

test('defaults produce no transform', () => {
  assert.equal(toCss(DEFAULT_EFFECTS, geometry).transform, '');
});
test('unrotated zoom does not get a scale correction', () => {
  const css = toCss({ ...DEFAULT_EFFECTS, zoom: 2 }, geometry);
  assert.equal(css.scaleCorrection, 1);
  assert.match(css.transform, /scale\(2, 2\)/);
});
test('quarter turn scales down to fit the box', () => {
  const css = toCss({ ...DEFAULT_EFFECTS, rotate: 90 }, geometry);
  assert.ok(Math.abs(css.scaleCorrection - 0.5625) < 1e-9);
  assert.match(css.transform, /rotate\(90deg\)/);
});
test('half turn needs no correction', () => {
  assert.equal(toCss({ ...DEFAULT_EFFECTS, rotate: 180 }, geometry).scaleCorrection, 1);
});
test('correction never upscales', () => {
  const tall = { videoWidth: 900, videoHeight: 1600, boxWidth: 900, boxHeight: 1600 };
  assert.ok(toCss({ ...DEFAULT_EFFECTS, rotate: 90 }, tall).scaleCorrection <= 1);
});
test('flips are negative scale, and compose with zoom', () => {
  const css = toCss({ ...DEFAULT_EFFECTS, flipX: true, zoom: 1.5 }, geometry);
  assert.match(css.transform, /scale\(-1\.5, 1\.5\)/);
});
test('pan emits pixels before rotation', () => {
  const css = toCss({ ...DEFAULT_EFFECTS, pan: { x: 10, y: -20 }, rotate: 45 }, geometry);
  assert.ok(css.transform.indexOf('translate(10px, -20px)') < css.transform.indexOf('rotate('));
});
test('zero-area geometry does not produce NaN', () => {
  const css = toCss({ ...DEFAULT_EFFECTS, rotate: 90 }, { videoWidth: 0, videoHeight: 0, boxWidth: 0, boxHeight: 0 });
  assert.equal(css.scaleCorrection, 1);
  assert.ok(!css.transform.includes('NaN'));
});
