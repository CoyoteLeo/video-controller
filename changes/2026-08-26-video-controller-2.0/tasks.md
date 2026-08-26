# Tasks: Video Controller 2.0

**Change:** changes/2026-08-26-video-controller-2.0/
**Plan:** /Users/leo/Desktop/cresclab/video-controller/changes/2026-08-26-video-controller-2.0/plan.md
**Design:** design.md

## Execution State

**Worktree:** _not started_
**PRs:** _none yet_

## Tasks

- [ ] Task 1: Split content.js into src/ — five modules, `globalThis.__videoController` namespace, action performer injected into videos.js; no behaviour change
- [ ] Task 2: Verify PR 1 changed nothing — shortcuts, theater, auto-theater, block list, iframe relay, late-attaching iframe, popup; record every result
- [ ] Task 3: transform.js — pure effects-to-CSS with the general rotated-bounding-box fit, 8 unit tests under bare `node --test`
- [ ] Task 4: Rewrite presentation.js as the effects owner — immutable state, single render, one restore point, theater becomes an effect
- [ ] Task 5: Theater regression checklist — 11 manual items; any deviation blocks PR 2
- [ ] Task 6: Verify the zero-permission messaging claim by running it, with `permissions` still `["storage"]`
- [ ] Task 7: Shadow host with independently-toggled toast and panel layers; toast moved in, host never hidden
- [ ] Task 8: Popup entry — availability handshake, three button states, idempotent open, block-list gate
- [ ] Task 9: Transform controls in the panel — rotate, flip, zoom, pan, reset-all; ancestor overflow verified
- [ ] Task 10: Playback controls — speed (clamped), loop, A-B repeat, frame step (labelled approximate)
- [ ] Task 11: Per-site memory pure functions — resolve, host matching, prune-to-empty; 6 unit tests
- [ ] Task 12: Wire per-site memory — implicit write, apply on startup, panel indicator and clear, panel position
- [ ] Task 13: Video ids and cross-frame listing — `getRandomValues` salt plus counter, `list-request` / `list-report`, progressive render
- [ ] Task 14: Targeted routing — separate propagation from the untargeted path, `pick-lost` direct to `window.top`
- [ ] Task 15: Picker UI and shortcut retargeting — pick held in memory, dropped on `pick-lost` and navigation
- [ ] Task 16: Release — version 2.0.0 in both manifests, README, full test run, fix the zip script's file list, verify the artifact
