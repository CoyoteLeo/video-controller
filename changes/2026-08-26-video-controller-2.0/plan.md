# Video Controller 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use ss-subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Video Controller from a keyboard remote into a video manipulation tool — image transform, playback control, and a cross-frame video picker driven from an in-page panel — without adding a build step or a permission.

**Architecture:** Today's single `content.js` is split into seven single-responsibility files under `src/`, loaded in a fixed order as one `content_scripts` entry and cooperating through a `globalThis.__videoController` namespace. A new presentation layer becomes the sole owner of the player's inline style and absorbs theater mode as one of its effects. A closed shadow root hosts the panel and the existing toast as two independently-toggled layers.

**Tech Stack:** Chrome MV3, plain ES2021 (no bundler, no TypeScript), `node --test` for the pure layers (no devDependency), `chrome.storage.sync` for global settings and `chrome.storage.local` for per-site memory.

**Design:** `design.md` in this directory. It is the authority — where this plan and the design disagree, the design wins and the plan is wrong.

---

## Scope check

One subsystem (a single browser extension), so one plan. It is staged across eight PRs because the middle of it rewrites working code, not because it is several subsystems.

## File structure

Created:

- `src/settings.js` — what settings exist, where they live, how a per-site profile resolves against global defaults. Pure functions plus storage-bound wrappers. `read()` is synchronous (cached snapshot).
- `src/transform.js` — pure, no DOM: effects → CSS. Unit tested.
- `src/videos.js` — which videos exist, which frame owns each, and all cross-frame messaging.
- `src/presentation.js` — sole owner of the player's inline style and of any ancestor `overflow` override. Holds the effects state. Theater is one of its effects.
- `src/playback.js` — speed, loop, A-B repeat, frame step.
- `src/panel.js` — the shadow host, the toast layer, the panel layer.
- `src/main.js` — entry: keydown handling, action dispatch, wiring, and the only file that touches `chrome.*`.
- `test/transform.test.js`, `test/settings.test.js` — Node test runner.

Modified:

- `manifest.json` — `content_scripts[0].js` becomes the ordered file list; `version` to `2.0.0` in the final PR. `permissions` is not touched.
- `popup.html` / `popup.js` — one new button and its three states.
- `package.json` — `test` script.
- `README.md` — features, configuration, project structure.

Deleted:

- `content.js` — redistributed, not kept as a shim.

### PR grouping

Stacked; each PR's base is the previous PR's branch, not `main`.

- **PR 1 — mechanical split, zero behaviour change.** Tasks 1–2. Base: `main`.
- **PR 2 — presentation layer, theater absorbed.** Tasks 3–5. Base: PR 1.
- **PR 3 — panel shell and popup entry.** Tasks 6–8. Base: PR 2.
- **PR 4 — transform controls.** Task 9. Base: PR 3.
- **PR 5 — playback controls.** Task 10. Base: PR 4.
- **PR 6 — per-site memory.** Tasks 11–12. Base: PR 5.
- **PR 7 — video picker and targeted routing.** Tasks 13–15. Base: PR 6.
- **PR 8 — release.** Task 16. Base: PR 7.

Ordering constraints and why:

- PR 1 must merge before anything else, and must contain no behaviour change. It is the only PR whose review question is "is this the same program?", which is impossible to answer if a feature rides along.
- PR 2 must land and be verified before PR 4–7. It rewrites theater mode, the only regression risk in the change; if a new effect were wired up in the same PR, a theater bug and a transform bug would be indistinguishable.
- PR 3 opens with Task 6, which can invalidate the design's panel entry point. Run it before building the panel on top of it.
- PR 6 comes after PR 4 and PR 5 because per-site memory needs values worth remembering.

---

## Task 1: Split content.js into src/, no behaviour change

**Files:**
- Create: `src/settings.js`, `src/videos.js`, `src/presentation.js`, `src/panel.js`, `src/main.js`
- Delete: `content.js`
- Modify: `manifest.json:23-30`, `README.md` (Project Structure block)

`transform.js` and `playback.js` are **not** created here — they arrive with the features that
need them. Do not create empty placeholder files.

### The one structural change allowed in this PR

Today everything is one closure, so functions call each other by bare name. After the split
they cannot, and two of today's calls point the wrong way: `tryHandleActionLocally` calls
`performAction`, and the storage callback calls `announceIfVideoFound` / `tryAutoTheater`.
`videos.js` must not reach up into `main.js` — routing does not get to know what an action
*means*.

So `videos.js` takes the action performer by injection, and `main.js` supplies it:

```js
// main.js
VC.videos.init({ onAction: performAction });
```

That is the only structural change in this PR. Everything else moves verbatim.

### Module shape

```js
(() => {
  const VC = (globalThis.__videoController ??= {});
  // ... definitions, moved verbatim ...
  VC.settings = { /* the exports listed below */ };
})();
```

`globalThis`, never `window` — Task 3 depends on these files being loadable in Node.

**Every cross-module reference is resolved at call time, never at load time.** No module body
reads another module's exports while loading. That is what makes the manifest order safe
(`panel.js` loads after `presentation.js`, yet `presentation.js` calls `VC.panel.showToast`
from inside `enter`/`exit`), and it is the same rule that keeps `chrome.*` and the DOM out of
load time.

### Interim exports for this PR

```js
VC.settings     = { DEFAULTS, read, matchHost, shouldAutoTheater, isDisabledHere, prime, onChange };
VC.videos       = { init, pick, routeLocally, bubble, hasAncestorVideo, announceIfVideoFound };
VC.presentation = { toggleTheater, leaveTheater, isTheaterActive, tryAutoTheater };
VC.panel        = { showToast };
```

`routeLocally` and `bubble` are today's `tryHandleActionLocally` and `bubbleActionToParent`.
`bubble` moves verbatim. `routeLocally` gets exactly one body change — the injected
`onAction(action, video)` in place of the bare `performAction(action, video)` at
content.js:373 — and nothing else.

`leaveTheater` is today's `exit`, and `isTheaterActive()` replaces the direct `theater.active`
reads in `togglePip` and `handler`.

`hasAncestorVideo()` exists because `handler` (moving to `main.js`) reads `ancestorHasVideo`
at content.js:413 to decide whether to bubble, while that flag is `videos.js`'s private state.
Without an accessor there is nothing for `main.js` to call — a grep would flag the bare
identifier but leave the implementer inventing the fix.

### Where every construct goes

Verified against the current `content.js`. Every top-level construct appears exactly once.

`src/settings.js`
- `DEFAULTS` (2-14), `let settings` (19)
- `hostMatchesDomain` (419-422) → exported as `matchHost`
- `shouldAutoTheater` (424-428), `isDisabledHere` (430-434)
- `chrome.storage.onChanged` listener (541-548) → the body of `onChange`
- the `chrome.storage.sync.get` call (535) **and the cache write at 536**
  (`settings = { ...settings, ...stored }`) → the body of `prime`. Line 536 is what populates
  the snapshot `read()` returns, so it belongs here and not with the orchestration below.

`src/videos.js`
- `MSG_TAG` (16), `isTop` (17), `hasDescendantVideo` / `ancestorHasVideo` (20-21)
- `pickVideo` (23-33) → exported as `pick`
- `broadcastActionToFrames` (352-358), `bubbleActionToParent` (360-368),
  `tryHandleActionLocally` (370-381), `announceAncestorHasVideoToFrames` (383-389)
- `announceVideoToParent` (447-450), `announcedToParent` / `announcedToDescendants` (452-453),
  `announceIfVideoFound` (454-464)
- the `message` listener (473-516)
- the MutationObserver block (518-533) — **the whole `if (!isTop) { … } else { … }`**, including
  both `const videoObserver` and `const topVideoObserver` and their `.observe()` calls
- the child-frame `hello` handshake (555-557, with its comment at 553-554) — the
  `if (!isTop) { window.parent.postMessage(…) }` at the very end of the file. Note 558 is the
  outer IIFE's own `})();`, not part of the handshake; each new file gets its own wrapper.
  Easy to miss and load-bearing: it is what makes a late-attaching iframe learn that an
  ancestor has a video.

`src/presentation.js`
- `theater` (129-139), `PLAYER_CLASS_RE` (141), `isPlayerLike` (143-147),
  `pickPlayerContainer` (149-163)
- `enter` (165-243), `exit` (245-270), `toggleTheater` (272-275)
- `autoTheaterDone` (436), `tryAutoTheater` (437-445)

`src/panel.js`
- `toastEl` / `toastTimer` (52-53), `showToast` (54-79)

`src/main.js`
- `VOLUME_STEP` (15)
- `TEXT_INPUT_TYPES` (38-41), `isTypingTarget` (43-50)
- `clamp` (81), `formatTime` (83-91), `keyEq` (93-97), `keyFromCode` (101-109),
  `eventMatches` (111-115), `matchAction` (117-127)
- `METADATA_TIMEOUT_MS` (277), `metadataReady` (282-289), `togglePip` (291-313)
- `performAction` (315-350), `handler` (391-417), `onAnyVideoPlay` (466-471)
- the `play` and `keydown` listener registrations (550-551)
- the startup orchestration from inside the storage callback (537-539):
  `announceIfVideoFound()`, `pickVideo()`, `tryAutoTheater(v)` — **537-539 only**; the cache
  write at 536 stays in `settings.js`. **This does not go to `settings.js`** — it is wiring,
  not a settings concern. `main.js` passes it to `prime` as a callback, or calls it from
  `prime`'s returned promise.

Comment blocks move with the construct they document (35-37, 99-100, 279-281).

- [ ] **Step 1: Create `src/settings.js`** using the inventory above. `prime(storage, onReady)`
  performs the initial `get` and registers the change listener. The file body must not call
  `chrome.*`.

- [ ] **Step 2: Create `src/videos.js`** using the inventory above. `init({ onAction })` stores
  the performer; `routeLocally` calls `onAction(action, video)` where today's code calls
  `performAction(action, video)` (content.js:373). Confirm the `hello` handshake made it in.

- [ ] **Step 3: Create `src/presentation.js`** using the inventory above. Move the theater
  implementation verbatim — restructuring happens in Task 4, not here. Replace its bare
  `showToast(…)` calls with `VC.panel.showToast(…)`.

- [ ] **Step 4: Create `src/panel.js`** using the inventory above. Only the toast; there is no
  panel yet.

- [ ] **Step 5: Create `src/main.js`** using the inventory above, plus the wiring:
  `VC.videos.init({ onAction: performAction })` and `VC.settings.prime(chrome.storage, …)`.
  `main.js` is the only file referencing `chrome.*`.

- [ ] **Step 6: Replace the bare cross-module calls**

  This grep is the plan's only defence against a missed cross-module call, so run it against
  every name that actually crosses a boundary — derived by walking each call site, not by
  recalling the obvious ones:

  `performAction`, `showToast`, `pickVideo`, `exit(`, `theater.active`, `toggleTheater`,
  `tryHandleActionLocally`, `routeLocally`, `bubbleActionToParent`, `bubble(`,
  `announceIfVideoFound`, `tryAutoTheater`, `shouldAutoTheater`, `isDisabledHere`,
  `ancestorHasVideo`, `settings.`

  Each hit must be a `VC.*` call or a local definition. Expected: no bare cross-module
  identifier remains. The ones most likely to be missed are `toggleTheater` (called from
  `performAction`, so it throws on the very first press of the theater key) and
  `shouldAutoTheater` (called from `tryAutoTheater` inside `presentation.js`).

- [ ] **Step 7: Update the manifest**

```json
"js": [
  "src/settings.js",
  "src/videos.js",
  "src/presentation.js",
  "src/panel.js",
  "src/main.js"
]
```

  Leave `run_at`, `all_frames`, `matches` and `permissions` exactly as they are.

- [ ] **Step 8: Update the README Project Structure block.** Replace the `content.js` line with
  the `src/` tree. Do not touch Features or Configuration in this PR.

- [ ] **Step 9: Delete `content.js`.** No shim, no re-export file.

- [ ] **Step 10: Load the extension and confirm it starts clean**

  Load unpacked, open a page with a video, open DevTools. Expected: no console errors, and no
  `ReferenceError` on the first shortcut press — that error is the signature of a missed
  cross-module call from Step 6.

## Task 2: Verify PR 1 changed nothing

No code. This task is the gate on the refactor; record each result rather than asserting "still works".

**Files:** none.

- [ ] **Step 1: Shortcuts**

On a page with a top-level video, exercise each binding: forward, backward, volume up, volume down, play/pause, mute, theater, picture-in-picture. Expected: identical toast text and behaviour to 1.7.0.

- [ ] **Step 2: Theater**

Toggle by key; leave by `Esc`, by backdrop click, and by the close button.

- [ ] **Step 3: Auto-theater**

Add a test domain to Auto Theater in the popup, reload, start playback. Expected: theater engages once, not repeatedly.

- [ ] **Step 4: Block list**

Confirm a blocked domain ignores every shortcut.

- [ ] **Step 5: Cross-origin iframe relay**

On a page whose player is in a cross-origin iframe, click the page body (not the player) and press a seek key. Expected: the iframe's video seeks — this is the v1.6.0 bubble path.

- [ ] **Step 6: Late-attaching iframe**

Specifically exercises the `hello` handshake, which is the construct most likely to be dropped
in Task 1. On a page with a video, inject an iframe after load
(`document.body.appendChild(document.createElement('iframe'))` pointing at a same-origin page),
click inside it, then press a seek key. Expected: the key still reaches the video in the
parent — the new frame asked, and was told, that an ancestor has a video.

- [ ] **Step 7: Popup**

Rebind a key, save, reload the page, confirm the new binding applies. Reset, confirm defaults return.

- [ ] **Step 8: Record results**

Write the outcome of steps 1–7 into the PR body. Any deviation is a blocker for PR 1, not a follow-up.

## Task 3: transform.js — pure effects-to-CSS, with tests

**Files:**
- Create: `src/transform.js`, `test/transform.test.js`
- Modify: `package.json` (add `"test": "node --test"` — **bare**, no path argument: Node
  resolves `--test test/` as a *module* to require and dies with `Cannot find module`, verified
  on Node 22)

The rotation scale correction uses the general rotated-bounding-box formula rather than special-casing 90/270 — the panel offers a free angle, so one formula covers both and there is no case list to maintain.

- [ ] **Step 1: Write the failing tests**

```js
// test/transform.test.js
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
  // 16:9 rotated into a 16:9 box fits at 9/16
  assert.ok(Math.abs(css.scaleCorrection - 0.5625) < 1e-9);
  assert.match(css.transform, /rotate\(90deg\)/);
});

test('half turn needs no correction', () => {
  // Exact equality on purpose: Math.sin(Math.PI) is 1.22e-16, not 0, so without an
  // epsilon snap in fitScale this lands on 0.9999999999999998.
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/transform.js'`. If the failure names `test`
rather than `transform.js`, the script still has a path argument; fix the script first.

- [ ] **Step 3: Write the implementation**

```js
// src/transform.js
(() => {
  const VC = (globalThis.__videoController ??= {});

  const DEFAULT_EFFECTS = Object.freeze({
    rotate: 0, flipX: false, flipY: false, zoom: 1,
    pan: Object.freeze({ x: 0, y: 0 }), theater: false,
  });

  // A rotated rectangle's bounding box. Covers the free angle the panel offers,
  // so 90/270 need no special case.
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
    // Never upscale: this corrects overflow, it is not a zoom.
    const fit = Math.min(1, boxWidth / box.w, boxHeight / box.h);
    // Math.sin(Math.PI) is 1.22e-16, so a half turn computes 0.9999999999999998 and
    // would emit a pointless scale(). Snap the no-op case to exactly 1.
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 8 tests.

- [ ] **Step 5: Add transform.js to the manifest**

Insert `"src/transform.js"` after `settings.js` in `content_scripts[0].js`. Order matters: `presentation.js` reads it.

## Task 4: Rewrite presentation.js as the effects owner

**Files:**
- Modify: `src/presentation.js` (full rewrite)

Theater stops being a lifecycle and becomes a value in the effects state. This is the task the whole staging exists to isolate.

- [ ] **Step 1: Define the state and the single entry point**

```js
VC.presentation = {
  apply,      // (patch) => void — merges into state immutably, then renders once
  current,    // () => effects (frozen copy)
  restore,    // () => void — removes everything this module added
};
```

`apply` builds `next` with object spread and never mutates the current state. There is no per-effect setter.

- [ ] **Step 2: Implement the takeover record**

One object holds everything that must be undone: the target video, the player container, their original `style` attributes, the original `document.documentElement.style.overflow`, the theater backdrop / placeholder / close button, and a list of `{ element, originalOverflow }` for every ancestor whose `overflow` was changed. Nothing outside this module records restoration state.

- [ ] **Step 3: Implement `render(effects)`**

Single pass, in this order: compute geometry from the video and its container, call `VC.transform.toCss`, write the video's `transform`, add or remove the theater DOM and container overrides, then apply or release ancestor `overflow`. When `effects` deep-equals `DEFAULT_EFFECTS`, take the full teardown path instead — the state must have exactly one representation of "nothing applied".

- [ ] **Step 4: Reroute every theater entry and exit through `apply`**

`toggleTheater`, `Esc`, backdrop click, close button, `tryAutoTheater`, and the picture-in-picture exit path in `main.js` all become `VC.presentation.apply({ theater: … })`. Grep for the old `enter(`/`exit(` call sites and confirm none remain.

- [ ] **Step 5: Implement ancestor overflow release**

Walk from the video's parent up to `document.body`. For each ancestor whose computed `overflow` is not `visible`, record the original inline value and set `overflow: visible`. Release restores the recorded inline values — including restoring "no inline value at all" by removing the property, not by writing `visible`.

- [ ] **Step 6: Confirm the tests still pass**

Run: `npm test`
Expected: PASS — this task must not change `transform.js` behaviour.

## Task 5: Theater regression checklist

**Files:** none. Run the extension; record every result in the PR body.

- [ ] **Step 1:** Theater on and off via the bound key.
- [ ] **Step 2:** `Esc` leaves theater.
- [ ] **Step 3:** Backdrop click leaves theater.
- [ ] **Step 4:** Close button leaves theater.
- [ ] **Step 5:** Auto-theater fires on a domain in `autoTheaterDomains` when playback starts.
- [ ] **Step 6:** Auto-theater does not fire on a domain in `disabledDomains`.
- [ ] **Step 7:** Theater inside a cross-origin iframe player.
- [ ] **Step 8:** Leaving theater restores the page exactly — no leftover inline style, no leftover `overflow` override, scroll position and page scrolling restored. Check by diffing the player's `style` attribute before and after.
- [ ] **Step 9:** Theater combined with a rotation applied by hand through the console (`VC.presentation.apply({ rotate: 90 })`), entered in both orders, then `restore()` — page returns to its original state.
- [ ] **Step 10:** Entering picture-in-picture while in theater still leaves theater, as in 1.7.0.
- [ ] **Step 11:** Any deviation blocks PR 2. Do not carry a theater regression into PR 3.

## Task 6: Verify the zero-permission messaging claim

**Files:** temporary scratch only — revert before finishing.

The design asserts from the API contract that `chrome.tabs.sendMessage` needs no permission. It has not been run. If it is wrong, the panel entry point is what changes — not the permission list.

- [ ] **Step 1: Add a temporary probe**

In `popup.js`, on load: query the active tab, send it `{ tag, type: 'ping' }`, log the reply. In `src/main.js`, add a `chrome.runtime.onMessage` listener replying `{ pong: true, host: location.hostname }`.

- [ ] **Step 2: Run it with permissions untouched**

Confirm `manifest.json` `permissions` is still `["storage"]`. Reload the extension, open the popup on an ordinary page, read the popup's console.
Expected: the reply arrives, and `chrome.tabs.query` returns a tab whose `url` is `undefined` (confirming the hostname genuinely is unavailable to the popup, which is why the handshake exists).

- [ ] **Step 3: Record and revert**

Paste the observed output into the PR body, then remove the probe. If no reply arrived, stop and report — do not add a permission to make it work.

## Task 7: Shadow host with two layers, toast moved in

**Files:**
- Modify: `src/panel.js`

- [ ] **Step 1: Create the host once, lazily, and keep it mounted**

One element on `document.documentElement`, `pointer-events: none`, carrying `attachShadow({ mode: 'closed' })`. Inside: a toast layer and a panel layer as siblings, each re-enabling `pointer-events` for its own content.

- [ ] **Step 2: Move the toast into the toast layer**

`showToast` keeps its signature and its 900ms behaviour. Only its mount point changes.

- [ ] **Step 3: Never hide the host**

Panel open/close toggles the panel layer only. Add a comment saying why, because `host.style.display = 'none'` is the obvious wrong implementation and it silently kills every toast.

- [ ] **Step 4: Verify**

With the panel closed, press seek / mute / theater keys. Expected: toasts appear as before. Then confirm page clicks land normally where the host overlaps content.

## Task 8: Popup entry with three button states

**Files:**
- Modify: `popup.html`, `popup.js`, `src/main.js`, `src/panel.js`

- [ ] **Step 1: Add the button**

One button above the key bindings, styled with the existing `.primary` / `.secondary` classes. No new colour; the accent stays `#0a7`.

- [ ] **Step 2: Availability handshake in `popup.js`**

On popup load: `chrome.tabs.query({ active: true, currentWindow: true })`, then `chrome.tabs.sendMessage(tabId, { tag, type: 'availability' })` with a 300ms timeout. Render `enabled` / `disabled-here` / `unavailable`. Once a terminal state is rendered, ignore any late reply.

- [ ] **Step 3: Reply from `src/main.js`**

Answer with `{ enabled: !VC.settings.isDisabledHere() }` and nothing else. Do not report video presence — the panel owns that fact and tracks it live.

- [ ] **Step 4: Idempotent open**

The open message means "make the panel visible". An already-open panel stays open and is raised; it is closed only from its own close button.

- [ ] **Step 5: Gate on the block list**

`isDisabledHere()` guards the open handler too, not just the keydown path.

- [ ] **Step 6: Verify all three states**

Ordinary page → opens. Domain in the block list → inert button explaining why. `chrome://extensions` → "unavailable on this page", not "blocked".

## Task 9: Transform controls in the panel

**Files:**
- Modify: `src/panel.js`, `src/main.js`

- [ ] **Step 1: Build the controls**

Rotate (90-degree steps plus a free-angle input), flip horizontal, flip vertical, zoom, pan, reset-all. Each emits `VC.presentation.apply({ … })`; the panel holds no effect state of its own — it renders `VC.presentation.current()`.

- [ ] **Step 2: Re-render on state change**

After any `apply`, the panel redraws from `current()`. One source of truth, no local mirror.

- [ ] **Step 3: Verify against a clipping ancestor**

Find a page whose player sits in an `overflow: hidden` container. Rotate 90°. Expected: no clipping. Reset. Expected: the ancestor's inline `overflow` is gone entirely, not set to `visible`.

- [ ] **Step 4: Verify composition**

Rotate, then flip, then zoom, then pan, in several orders. Expected: the same visual result for the same final state, and reset-all returns the page to its original DOM and style.

## Task 10: Playback controls

**Files:**
- Create: `src/playback.js`
- Modify: `manifest.json`, `src/panel.js`

- [ ] **Step 0: Add playback.js to the manifest in the right slot**

Insert `"src/playback.js"` **after `src/presentation.js` and before `src/panel.js`**, matching
the design's fixed load order. Do not append it at the end.

- [ ] **Step 1: Speed and loop**

`setRate(video, rate)` clamps to 0.0625–16 before assigning `playbackRate`, because Chrome throws outside that range. `setLoop(video, on)` assigns `loop`.

- [ ] **Step 2: A-B repeat**

Store `{ a, b }`; attach one `timeupdate` listener that seeks to `a` when `currentTime >= b`. Clearing either point removes the listener — do not leave a dormant listener attached.

- [ ] **Step 3: Frame step**

Pause, then move `currentTime` by one frame. The API does not expose the frame rate, so the panel offers a small set of common rates and defaults to 1/30s. Label it in the UI as approximate; do not present a guess as exact.

- [ ] **Step 4: Verify**

Speed above 2x plays without throwing. Clamp holds at the boundary. A-B loops and stops looping when cleared. Frame step advances while paused.

## Task 11: Per-site memory — pure functions with tests

**Files:**
- Modify: `src/settings.js`
- Create: `test/settings.test.js`

- [ ] **Step 1: Write the failing tests**

```js
const test = require('node:test');
const assert = require('node:assert');
require('../src/settings.js');
const { matchHost, resolve, nextProfiles } = globalThis.__videoController.settings;

const defaults = { rotate: 0, zoom: 1 };

test('matchHost covers exact and subdomain, not suffix collisions', () => {
  assert.equal(matchHost('example.com', 'example.com'), true);
  assert.equal(matchHost('www.example.com', 'example.com'), true);
  assert.equal(matchHost('notexample.com', 'example.com'), false);
  assert.equal(matchHost('example.com', ''), false);
});

test('resolve overlays a profile on defaults', () => {
  assert.deepEqual(resolve(defaults, { rotate: 90 }), { rotate: 90, zoom: 1 });
  assert.deepEqual(resolve(defaults, undefined), defaults);
});

test('a non-default value is stored under the exact hostname', () => {
  const next = nextProfiles({}, 'www.example.com', 'rotate', 90, defaults);
  assert.deepEqual(next, { 'www.example.com': { rotate: 90 } });
});

test('returning to the default removes the key, then the empty entry', () => {
  const stored = { 'a.com': { rotate: 90 } };
  assert.deepEqual(nextProfiles(stored, 'a.com', 'rotate', 0, defaults), {});
});

test('an entry with other keys survives one key returning to default', () => {
  const stored = { 'a.com': { rotate: 90, zoom: 2 } };
  assert.deepEqual(nextProfiles(stored, 'a.com', 'rotate', 0, defaults), { 'a.com': { zoom: 2 } });
});

test('nextProfiles does not mutate its input', () => {
  const stored = { 'a.com': { rotate: 90 } };
  nextProfiles(stored, 'a.com', 'zoom', 2, defaults);
  assert.deepEqual(stored, { 'a.com': { rotate: 90 } });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `resolve`/`nextProfiles` undefined.

- [ ] **Step 3: Implement, immutably**

`nextProfiles` returns a new map and new entry objects; it never writes through to its argument.

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS — the transform tests still pass too.

## Task 12: Wire per-site memory

**Files:**
- Modify: `src/settings.js`, `src/main.js`, `src/panel.js`

- [ ] **Step 1: Load and apply on startup**

`prime` also reads `siteProfiles` from `chrome.storage.local` and resolves the entry for `location.hostname`. Apply it once the video is known. Skip entirely when `isDisabledHere()`.

- [ ] **Step 2: Write on change**

Every `apply` and every playback change routes through `VC.settings.setSiteValue`, which uses `nextProfiles` and persists. Never write when disabled here.

- [ ] **Step 3: Panel indicator and clear**

Header shows the remembered count for this host and offers a clear that deletes the whole entry and resets live state to defaults in one action.

- [ ] **Step 4: Panel position**

Dragging persists through the same mechanism.

- [ ] **Step 5: Verify**

Rotate a site, reload — rotation returns. Clear — reload shows no rotation and `chrome.storage.local` has no entry for that host. Confirm `www.` and `m.` subdomains are independent entries.

## Task 13: Video ids and cross-frame listing

**Files:**
- Modify: `src/videos.js`

- [ ] **Step 1: Mint ids**

Per-frame salt from `crypto.getRandomValues()`, plus a counter: `` `${salt}-${n++}` ``. Not `crypto.randomUUID()` — it is secure-context-only and this extension matches `<all_urls>`.

- [ ] **Step 2: `list-request` / `list-report`**

Gate both on `VC.settings.isDisabledHere()` first: a frame on a blocked domain answers nothing
and forwards nothing. The design makes the block list a single gate over *everything*, and a
frame that still reports its videos is a hole in that guarantee.

On `list-request`, forward to every child, then reply with this frame's videos: id, size, duration, playing. On `list-report`, forward children's reports up to the parent so they accumulate at the top frame.

- [ ] **Step 3: Render progressively**

The picker renders what has arrived and updates as more reports come in. It never blocks on a complete tree — a cross-origin frame may never answer.

- [ ] **Step 4: Verify on nested frames**

A page with a player in a cross-origin iframe plus a video in the top document. Expected: both listed, ids distinct.

## Task 14: Targeted routing

**Files:**
- Modify: `src/videos.js`

The `target == null` path must stay behaviourally identical to today's. Do not refactor `tryHandleActionLocally` while adding the new branch.

- [ ] **Step 1: Branch `send(target, action, payload)`**

`target == null` → today's path, untouched. `target != null` → the new propagation.

- [ ] **Step 2: Implement targeted receive**

Gate on `VC.settings.isDisabledHere()` before anything else, exactly as the untargeted `action`
handler already does — a blocked frame neither acts nor forwards.

Own the id → act and stop, no forwarding. Otherwise → forward to every child except the sender **and** bubble to the parent unless the parent was the sender. Both, regardless of whether this frame has videos of its own. Add a comment: consuming a targeted action because this frame happens to have *a* video is the exact bug this branch exists to avoid.

- [ ] **Step 3: `pick-lost`**

The owning frame watches its picked element; when it leaves the DOM, post `pick-lost` **directly to `window.top`**, not hop by hop. The top frame clears the selection and falls back to the heuristic.

- [ ] **Step 4: Verify by hand-tracing, then in the browser**

Build the design's case: top frame with its own video, two children, the target owned by a grandchild, keydown originating in the other child. Expected: only the grandchild's video responds, and the top frame's own video never does.

## Task 15: Picker UI and shortcut retargeting

**Files:**
- Modify: `src/panel.js`, `src/main.js`

- [ ] **Step 1: Picker list**

Render the reports; selecting one stores the id in memory in the top frame. Metadata only — no thumbnails.

- [ ] **Step 2: Retarget the keyboard shortcuts**

With a pick active, existing shortcuts send with that target. With no pick, they send `target == null` and behave exactly as today.

- [ ] **Step 3: Drop the pick when it dies**

Clear on `pick-lost` and on navigation. Do not persist it per site — a stored element id is meaningless on the next load.

- [ ] **Step 4: Verify**

On a multi-video page, pick the non-obvious video and confirm seek and volume follow it. Remove that video from the DOM via the console and confirm the selection clears and the heuristic resumes.

## Task 16: Release

**Files:**
- Modify: `manifest.json`, `package.json`, `README.md`

- [ ] **Step 1: Version**

`2.0.0` in both `manifest.json` and `package.json`. They drifted once before; keep them equal.

- [ ] **Step 2: README**

Features, Configuration, and Project Structure. State plainly that frame step is approximate and that per-site settings are remembered automatically and cleared from the panel.

- [ ] **Step 3: Full test run**

Run: `npm test`
Expected: PASS, all tests.

- [ ] **Step 4: Package**

Run: `npm run zip` — first update the `zip` script's file list, which still names `content.js`.

- [ ] **Step 5: Verify the artifact**

Unzip and confirm the manifest version, the seven `src/` files, and that `content.js` is absent.
