# Video Controller 2.0 — design

Status: approved for planning
Target version: 2.0.0
Supersedes: nothing (first change packet in this repo)

## Goal

Grow Video Controller from a keyboard remote into a video *manipulation* tool, without
giving up the two properties that make it pleasant today: no build step, and no
interference with the site's own player UI.

Two feature families plus one utility:

- **Image transform** — rotate, horizontal / vertical flip, zoom, pan.
- **Playback control** — speed (including above 2x), loop, A-B repeat, frame step.
- **Video picker** — choose which video on the page the controls act on, including
  videos inside child frames.

All new features are driven from an in-page control panel. The existing keyboard
shortcuts are unchanged and no new key bindings are added.

## Non-goals

Explicitly out of scope for 2.0, listed so a planner does not add them back:

- Color filters (brightness, contrast, saturation, grayscale, blur).
- Audio processing (volume boost above 100%, channel switching, pitch, EQ).
- Frame capture / screenshot.
- Focus mode (dimming the rest of the page).
- Video download (would require a background service worker and `webRequest`,
  a permission surface out of proportion to the rest of the extension).
- Thumbnail previews in the video picker.
- Any new keyboard shortcut.

## Decisions already settled

Recorded so the plan does not re-litigate them:

- Transform is applied to the `<video>` element, not to the player container and not
  by moving the video into a wrapper element.
- No build step. Multiple content script files, loaded in order, sharing one isolated
  world.
- Theater mode is absorbed into the presentation layer as one of its effects, rather
  than remaining a parallel mechanism.
- Per-site settings are remembered implicitly, the moment a value changes.
- Per-site settings live in `chrome.storage.local` under a single `siteProfiles` key.
  The existing flat `chrome.storage.sync` keys are untouched.
- The panel is opened from the toolbar popup, and needs no new permission to do so.
- The domain block list disables the panel and every new feature too, not just the
  keyboard shortcuts.
- A video picked by hand becomes the target of the existing keyboard shortcuts as well.

## Architecture

### Why transform targets the video element

Applying `transform` to the `<video>` element leaves the site's control bar, subtitle
layer and progress bar untouched — they are siblings or ancestors, not children of the
video. Applying it to the player container would rotate the controls along with the
picture, which is unusable. Moving the video into an extension-owned wrapper gives the
most control but re-initialises many players, and DOM re-parenting also closes any open
picture-in-picture window.

The cost of targeting the video element is clipping: a rotated video can exceed an
ancestor whose `overflow` is `hidden`. The presentation layer handles this by walking the
ancestor chain, recording the original `overflow` of each element that would clip, and
setting it to `visible` — restoring every recorded value on reset.

### File split

`manifest.json` lists these in order under one `content_scripts` entry. Files in a single
entry execute in the same isolated world and share one global scope, so they can
cooperate without a bundler.

Sharing a global scope means name collisions are a real hazard here: three of these
modules would otherwise each export a bare `apply()`, `current()` or `restore()`. So the
convention is explicit — each file is an IIFE that leaks exactly one thing, a property on
a single namespace object, and that object hangs off `globalThis`, never `window`:

```js
// settings.js
(() => {
  const VC = (globalThis.__videoController ??= {});
  VC.settings = { resolve, nextProfile, matchHost, read, setSiteValue, clearSite };
})();
```

`globalThis` rather than `window` is load-bearing, not a style choice: it is what lets the
pure modules be loaded by Node's test runner (see Testing). Each frame's isolated world has
its own `window`, so each frame gets its own namespace object — which is what we want, and
mirrors today's per-frame module state in `content.js`.

**No module touches `chrome.*` or the DOM at load time.** A module's file-level body only
defines functions and registers them on the namespace; anything that reads storage or the
document happens when `main.js` calls it. That is what keeps the pure half loadable outside
a browser.

Load order follows the dependency direction and is fixed in the manifest: `settings.js`,
`transform.js`, `videos.js`, `presentation.js`, `playback.js`, `panel.js`, `main.js`.
`main.js` is last because it is the only file that reads every other module.

- `src/settings.js` — the only layer that knows what settings exist, where they are
  stored, and how a per-site profile resolves against global defaults.
  Exposes `read()`, `setSiteValue(key, value)`, `clearSite()`, `onChange(cb)`.
  `read()` is **synchronous**: it returns the cached resolved snapshot, exactly as
  `content.js` does today by priming a closure once and patching it from
  `chrome.storage.onChanged`. `main.js` primes it at startup and keeps it fresh. Making it
  async would put an await in the keydown path and change shortcut latency, which is not
  something this change is willing to trade.
- `src/videos.js` — the only layer that knows which videos exist and which frame owns
  each one. Absorbs today's `pickVideo` and the postMessage relay.
  Exposes `pick()`, `list()`, `send(target, action, payload)`.
- `src/transform.js` — pure functions, no DOM access. Maps an effects object to the CSS
  it implies. Exposes `toCss(effects, geometry)` returning
  `{ transform, scaleCorrection }`.
- `src/presentation.js` — the only layer that knows what the player's inline style and
  ancestor `overflow` have been changed to and how to put them back. Owns the effects
  state. Exposes `apply(patch)`, `current()`, `restore()`.
- `src/playback.js` — speed, loop, A-B repeat, frame step. Direct `HTMLVideoElement`
  property manipulation, no DOM structure changes.
- `src/panel.js` — the control panel inside a closed shadow root, plus the existing
  toast. Reads state, emits intents; makes no policy decisions of its own.
- `src/main.js` — entry point: keydown handling, action dispatch, wiring.

`content.js` is deleted; its contents are redistributed across the files above.

### The presentation layer

Today theater mode and any new transform would both write inline style on the same
player and each keep its own copy of "the original value". Two owners of one piece of
state guarantees they will eventually disagree. The presentation layer becomes the single
owner.

State shape:

```js
{ rotate: 0, flipX: false, flipY: false, zoom: 1, pan: { x: 0, y: 0 }, theater: false }
```

Rules:

- Updates are immutable. `apply(patch)` computes a new state object and never mutates
  the current one.
- A single `render(state)` computes everything and writes it in one pass. There is no
  per-effect mutation path.
- When every value is back to its default, everything the layer added is removed: inline
  style, ancestor `overflow` overrides, and theater's DOM move. No residue.
- `restore()` is the single restoration point.
- Theater is an effect, not a lifecycle. Entering and leaving theater is
  `apply({ theater: true | false })`. Auto-theater, `Esc`, the backdrop click and the
  close button all route through that one call.

Rotating 90 or 270 degrees swaps the effective width and height, so the video must be
scaled down to keep fitting its box. `transform.js` computes that `scaleCorrection` from
the video's and container's aspect ratios; it is a pure function and is unit tested.

### Playback control

- **Speed** — sets `playbackRate`. Values above 2x are allowed; Chrome caps around 16x
  and rejects beyond that, so the panel clamps to a documented range.
- **Loop** — sets the `loop` property.
- **A-B repeat** — stores two timestamps; a `timeupdate` listener seeks back to A when
  the playhead passes B. Clearing either point removes the listener.
- **Frame step** — pauses and moves `currentTime` by one frame. Frame duration is not
  exposed by the API; the panel offers a small set of common frame rates and defaults to
  1/30s, which is honest about being an approximation.

### Video discovery and the frame protocol

The existing message types are kept: `has-video`, `ancestor-has-video`, `hello`,
`action`, `action-bubble`. Two changes:

- `action` gains a payload and a target. Today it carries only an action name, which is
  enough for "seek forward" but not for "rotate to 90" or "set speed to 1.5". The shape
  becomes `{ type: 'action', action, payload, target }`, where `target` is either a video
  id or `null` for "whichever video you would have picked anyway" (today's behaviour).
- New `list-request` / `list-report` pair, so the picker can enumerate videos across the
  frame tree.

**Video ids are globally unique, not frame-local.** Each frame mints an id for each video
it owns and stores it on the element. A frame-local index would collide between sibling and
nested frames and could not be routed.

The id is a per-frame random salt plus a counter (`${salt}-${n++}`), with the salt from
`crypto.getRandomValues()`. Not `crypto.randomUUID()`: that one is restricted to secure
contexts, and this extension matches `<all_urls>`, so it is unavailable on plain-HTTP
pages. `getRandomValues` carries no such restriction.

**Targeted and untargeted actions need different propagation rules.** This is the one place
the existing relay cannot simply be reused. Today's stopping rule is "if this frame has any
video, act on it and stop" — `tryHandleActionLocally` calls `pickVideo()` and, if it finds
anything, performs the action and never forwards to children. That is correct for an
untargeted action and wrong for a targeted one: on a page whose top document has its own
`<video>` (an ad, a secondary player) and whose real player is in an iframe, a targeted
action would be swallowed by the top frame's video — exactly the case the picker exists to
fix.

So `videos.js`'s `send(target, action, payload)` branches, and the two branches do not
share a code path:

- `target == null` — today's behaviour, untouched: act locally if this frame has a video,
  otherwise broadcast down / bubble up. `tryHandleActionLocally` keeps its current shape.
- `target != null` — **its own propagation, modelled on the discovery messages rather than
  on `tryHandleActionLocally`.**

A targeted action must reach one specific frame, and no frame knows where that frame is:
`hasDescendantVideo` and `ancestorHasVideo` record only that *a* video exists somewhere, not
which subtree holds a given id. This direction matters more than it first looks, because a
manual pick retargets the existing keyboard shortcuts — so a targeted action can originate
from a keydown in *any* frame, and the target may sit in a sibling subtree reachable only by
going up and then back down.

On receiving a targeted action, a frame does exactly this:

- If it owns the id: act, and stop. Do not forward.
- Otherwise: forward to every child except the sender, **and** bubble to the parent unless
  the parent was the sender. Both, not either — and regardless of whether this frame has
  videos of its own. A frame that has a video but not *this* video must not consume the
  message, which is precisely the bug in reusing today's stop condition.

Termination needs no message ids or dedup table: the frame tree is a tree, so excluding the
sender means each frame receives the message across exactly one edge and forwards it across
every other edge. The walk covers every frame once and cannot cycle.

If no frame owns the id — the picked video was removed — the flood dies out and nothing
happens. That is not left as a silent dead end: the frame that owns a picked video watches
it, and when the element leaves its DOM it notifies the top frame, which clears the
selection and falls back to the heuristic.

That notification goes **straight to `window.top`**, not hop by hop. `window.top` is
reachable from any depth, including across origins, and the top frame is the only party that
cares — unlike `ancestor-has-video`, which bubbles one hop at a time precisely because every
ancestor needs to learn from it. Relaying `pick-lost` through intermediate frames would mean
every frame needs a handler for a message that is none of its business, and modelling it on
the existing single-hop `postMessage(parent)` calls would leave a video owned two or more
levels deep unable to reach the top at all.

**Traversal shape stays undirected.** No path-based routing is introduced: each frame only
ever talks to its own children and its immediate parent, so every edge of the frame tree
carries at most one copy of a message and there is no re-broadcast storm. The new messages
keep that property:

- `list-request` — each frame that receives it forwards it to its own children, then
  replies with its own videos.
- `list-report` — each frame forwards reports received from its children up to its own
  parent, so reports accumulate as they climb to the top frame. A report carries the
  video's id, size, duration and whether it is playing.
- An `action` carrying a `target` uses the propagation rule above: owner acts and stops,
  everyone else forwards both ways and does nothing.
- `pick-lost` — posted directly to `window.top` by the frame that owned a picked video when
  that element leaves its DOM, so the top frame can clear the selection. Not relayed
  hop-by-hop; see below.

Because reports arrive asynchronously and a cross-origin frame may never answer, the
picker renders the list it has and updates as more reports arrive. It never blocks waiting
for a complete tree.

Cross-origin frames cannot provide a thumbnail, so the picker lists metadata only.

The panel renders only in the top frame. Every frame keeps its own content script, as
today, so a frame that owns a video can act on it locally.

### What a manual pick changes

Picking a video by hand sets it as the active target for **everything**, including the
existing keyboard shortcuts. The picker exists because `pickVideo()`'s heuristic (first
playing video, else largest) guesses wrong on multi-video pages; if seek and volume kept
following the heuristic after an explicit pick, the picker would only solve half of its
own problem.

The pick is remembered in memory only, in the top frame, and is dropped when the page
navigates or when the chosen video disappears from its frame's DOM — at which point the
heuristic applies again. It is not persisted per site: a stored element id would be
meaningless on the next page load. With no manual pick in effect, behaviour is exactly
today's.

### Settings and per-site memory

Two kinds of per-domain state already exist and stay exactly as they are:
`autoTheaterDomains` and `disabledDomains` in `chrome.storage.sync`, both matching
subdomains. Those are rules the user declares.

Per-site memory is a different thing — an observation of what the user did on one site —
so it gets its own store and its own matching semantics:

- Stored in `chrome.storage.local` under a single `siteProfiles` object, keyed by the
  full `location.hostname`. No subdomain inference: `www.example.com` and
  `m.example.com` are separate entries, because guessing here would surprise the user.
- `chrome.storage.local` rather than `sync` because sync caps items at 8KB and the whole
  area at 100KB, which a few hundred remembered sites would exceed. A "rotate this site
  90 degrees" preference is also reasonably machine-local.
- Writing is implicit: when a value changes, it is written to `siteProfiles[hostname]` if
  it differs from the global default, and removed from that entry if it equals the
  default. When an entry has no keys left, the entry itself is deleted. So only
  non-default values are ever stored and the map does not accumulate no-op entries.
- The existing flat sync keys are not migrated and the popup's existing read/write logic
  does not change.

Because writing is implicit, the panel must make it visible and reversible: its header
shows how many values are remembered for the current site and offers a one-click clear.

### The block list disables everything, not just shortcuts

`disabledDomains` means one thing: the extension is fully off on that domain. That
includes the panel, the transform and playback features, the picker, and any per-site
memory — nothing is written and nothing is applied. Carving out an exception for the panel
would give that one list a second meaning, and it would quietly break the guarantee the
README already makes, which matters because the shipped default blocks `youtube.com` and
`netflix.com`.

**The check lives in the content script, in one place.** It is the only context that knows
`location.hostname` without a permission, so `isDisabledHere()` stays where it is today and
becomes the single gate: it guards the keydown handler, the panel open request, every
message handler, and all per-site writes. The popup never evaluates the block list itself —
it only renders the answer the content script gives it (see Panel UI). One owner for the
rule, one place to get it wrong.

### Panel UI

- Opened from a new button in the toolbar popup. The popup gets the active tab's id with
  `chrome.tabs.query({ active: true, currentWindow: true })` and sends it a message with
  `chrome.tabs.sendMessage`. **Neither call needs a new permission**: the `tabs`
  permission only gates the `url`, `pendingUrl`, `title` and `favIconUrl` fields of a
  `Tab`, none of which are used here, and messaging a content script that the manifest
  already injects requires no host permission. Using `chrome.storage` as the channel
  instead was rejected: a storage change broadcasts to every tab, which would open a
  panel in all of them.
- **The popup cannot read the hostname, so it asks.** Because no permission is added, the
  `Tab` object's `url` is `undefined` and the popup has no way to evaluate the block list
  itself. On open it sends an availability query to the active tab; the content script — which
  has `location.hostname` for free — replies with one thing only: whether it is enabled here.
  It deliberately does **not** report whether a video is present. Video presence changes while
  the panel is open (SPA navigation, late-loading players) and the panel already tracks it
  live, so making it a fourth button state would put the same fact under two owners and let
  the popup's copy go stale. The panel opens either way and shows its own empty state until a
  video appears. The button renders one of three states:
  - **enabled** — opens the panel.
  - **disabled on this site** — the hostname is in the block list; the button is inert and
    says so, pointing at the popup's own block list field.
  - **unavailable on this page** — no reply arrived before a short timeout, meaning no
    content script is running (a `chrome://` page, the Web Store, a PDF viewer). This is a
    distinct state from the other two and must not be reported as "blocked". Once a terminal
    state is rendered the popup ignores a late reply, so a slow answer cannot overwrite it.
- **Opening is idempotent.** The panel outlives any one popup lifecycle, so the button may be
  clicked while a panel is already open in that tab. The message means "make the panel
  visible", not "toggle": an already-open panel stays open and is brought to the front. The
  panel is closed from its own close button, not from the popup.
- Rendered into a closed shadow root with its own reset, so the page's CSS cannot leak in
  and the panel's cannot leak out. One extension-owned host element on
  `document.documentElement` carries that shadow root, and the existing toast moves inside
  it, so both get the same isolation.
- **The host is always mounted; the two layers inside it toggle independently.** Inside the
  shadow root are two siblings — a toast layer and a panel layer — each shown and hidden on
  its own. "Panel closed" hides the panel layer, never the host. Hiding the host would kill
  every toast (theater, mute, seek, picture-in-picture) whenever the panel is closed, which
  is most of the time. The host itself keeps `pointer-events: none`, with each layer
  re-enabling pointer events for its own content, so an always-mounted host never swallows
  clicks meant for the page.
- Draggable, and its position is remembered per site through the same `siteProfiles`
  mechanism.
- Visual language follows the existing popup: the teal accent already in `popup.html`
  (`#0a7`), light and dark following the system preference. No purple.
- Controls: rotate (90-degree steps plus a free angle), flip horizontal / vertical, zoom,
  pan, speed, loop, A-B repeat, frame step, video picker, reset-all, and the per-site
  memory indicator with its clear button.

### Manifest changes

- `version` to `2.0.0`.
- `permissions` is **unchanged** — `storage` only. 2.0 adds no permission.
- `content_scripts[0].js` becomes the ordered list of `src/*.js` files, in the load order
  fixed above.
- `web_accessible_resources` is not needed — the panel is built in JS, not fetched.

## Testing

The repo has no test framework and does not need one. The layers were split so that the
decision-making half is testable without a browser:

- `src/transform.js` — effects to CSS, and the rotation scale correction. Pure.
- `src/settings.js` — per-site write / remove / delete-empty-entry logic, default
  resolution, and host matching. Pure once the storage calls are passed in.

Both run under Node's built-in test runner (`node --test`), so no devDependency is added.
A `npm test` script is added for them.

This works only because of two constraints stated in the File split: the namespace hangs off
`globalThis` rather than `window`, and no module touches `chrome.*` or the DOM at load time.
A test `require`s the file, which registers `globalThis.__videoController.<module>`, then
calls the pure functions directly. The storage-bound wrappers in `settings.js` are not unit
tested — they are the adapter boundary, and `main.js` is what hands them the real
`chrome.storage`.

The DOM half is verified by running the extension. Because the presentation layer rewrites
theater mode, theater gets an explicit regression checklist, each item run by hand and its
result recorded:

- Theater on and off via the bound key.
- `Esc` leaves theater.
- Backdrop click leaves theater.
- Close button leaves theater.
- Auto-theater fires on a domain in `autoTheaterDomains` when playback starts.
- Auto-theater does not fire on a domain in `disabledDomains`.
- Theater inside a cross-origin iframe player.
- Leaving theater restores the page exactly: no leftover inline style, no leftover
  `overflow` override, scroll position and page scrolling restored.
- Theater combined with a rotation, entered in both orders, then reset — page returns to
  its original state.
- Entering picture-in-picture while in theater still leaves theater, as in 1.7.0.

## Risks

- **Rewriting theater mode is the only regression risk in this change.** It is currently
  working code with several entry and exit paths. Mitigated by the checklist above; if
  the plan needs to stage the work, theater's absorption into the presentation layer
  should be its own step with its own verification, landing before any new effect is
  wired up.
- **Ancestor `overflow` manipulation touches page layout.** Restoring it precisely
  matters more than the effect itself; every changed element and its original value must
  be recorded, and the reset path is what gets tested first.
- **Implicit per-site memory can surprise.** A user who rotates a video once will find it
  rotated on the next visit. The panel's indicator and clear button are the mitigation,
  and they are part of the same change, not a follow-up.
- **`playbackRate` above roughly 16x throws.** Clamp in the panel rather than letting the
  exception surface.
- **The zero-new-permission claim is from the API contract, not yet from a run.** The
  first implementation step that wires the popup button to the panel must confirm
  `chrome.tabs.sendMessage` reaches the content script with `permissions` still holding
  only `storage`. If it does not, the panel entry point is the section to revisit, not the
  permission list to grow.
