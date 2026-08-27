const test = require('node:test');
const assert = require('node:assert');
require('../src/settings.js');
const { matchHost, resolve, nextProfiles } = globalThis.__videoController.settings;

const defaults = { rotate: 0, zoom: 1, pan: { x: 0, y: 0 } };

test('matchHost covers exact and subdomain, not suffix collisions', () => {
  assert.equal(matchHost('example.com', 'example.com'), true);
  assert.equal(matchHost('www.example.com', 'example.com'), true);
  assert.equal(matchHost('notexample.com', 'example.com'), false);
  assert.equal(matchHost('example.com', ''), false);
});

test('resolve overlays a profile on defaults', () => {
  assert.deepEqual(resolve(defaults, { rotate: 90 }), { rotate: 90, zoom: 1, pan: { x: 0, y: 0 } });
  assert.deepEqual(resolve(defaults, undefined), defaults);
});

test('a non-default value is stored under the exact hostname', () => {
  assert.deepEqual(nextProfiles({}, 'www.example.com', 'rotate', 90, defaults),
    { 'www.example.com': { rotate: 90 } });
});

test('returning to the default removes the key, then the empty entry', () => {
  assert.deepEqual(nextProfiles({ 'a.com': { rotate: 90 } }, 'a.com', 'rotate', 0, defaults), {});
});

test('an entry with other keys survives one key returning to default', () => {
  assert.deepEqual(nextProfiles({ 'a.com': { rotate: 90, zoom: 2 } }, 'a.com', 'rotate', 0, defaults),
    { 'a.com': { zoom: 2 } });
});

test('object values compare by shape, not identity', () => {
  // A fresh {x:0,y:0} is the default even though it is a different object.
  assert.deepEqual(nextProfiles({ 'a.com': { pan: { x: 5, y: 5 } } }, 'a.com', 'pan', { x: 0, y: 0 }, defaults), {});
  assert.deepEqual(nextProfiles({}, 'a.com', 'pan', { x: 5, y: 0 }, defaults),
    { 'a.com': { pan: { x: 5, y: 0 } } });
});

test('nextProfiles does not mutate its input', () => {
  const stored = { 'a.com': { rotate: 90 } };
  nextProfiles(stored, 'a.com', 'zoom', 2, defaults);
  assert.deepEqual(stored, { 'a.com': { rotate: 90 } });
});

test('subdomains are independent entries', () => {
  let p = nextProfiles({}, 'www.a.com', 'rotate', 90, defaults);
  p = nextProfiles(p, 'm.a.com', 'rotate', 180, defaults);
  assert.deepEqual(p, { 'www.a.com': { rotate: 90 }, 'm.a.com': { rotate: 180 } });
});
