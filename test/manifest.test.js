const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

// The Web Store enforces these at upload, which is far too late to find out.
test('description fits the Web Store limit', () => {
  assert.ok(manifest.description.length <= 132,
    `description is ${manifest.description.length} chars, limit is 132`);
});

test('name fits the Web Store limit', () => {
  assert.ok(manifest.name.length <= 45, `name is ${manifest.name.length} chars, limit is 45`);
});

test('manifest and package versions agree', () => {
  assert.equal(manifest.version, pkg.version);
});

test('every content script file listed actually exists', () => {
  for (const file of manifest.content_scripts[0].js) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', file)), `${file} is listed but missing`);
  }
});

test('the popup the action points at exists', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '..', manifest.action.default_popup)));
});
