# Video Controller

<p align="center">
  <img src="icons/icon-128.png" alt="Video Controller icon" width="96" height="96" />
</p>

A minimalist Chrome extension that gives every HTML5 video on the web a consistent, configurable keyboard remote — plus one-key **Picture in Picture**, a one-key **Theater Mode**, and a domain allowlist that enables it automatically.

## Features

- **Seek** forward / backward with any key (default: `→` / `←`)
- **Volume** up / down with any key (default: `↑` / `↓`)
- **Play / Pause** and **Mute** with any key (defaults: `Space` / `M`)
- **Picture in Picture** — toggles Chrome's native floating player, which stays on top across tabs and is resized by dragging its edges (default: `P`). Works even on sites that mark their video `disablePictureInPicture`
- **Control panel** — click the toolbar icon and the panel opens on the page: rotate, flip, zoom, pan, speed, loop, A-B repeat, frame stepping, the video picker, and every setting. Frame stepping is approximate: the API does not expose a video's real frame rate
- **Video picker** — on a page with several videos, choose which one the controls and the keyboard shortcuts act on, including videos inside cross-origin iframes
- **Per-site memory** — panel settings are remembered automatically for the exact hostname you set them on, and cleared from the panel's own button
- **Theater Mode** — enlarges the video player to fill the viewport with a black backdrop; custom player controls stay intact (default: `T`)
- **Auto Theater** — list domains where Theater Mode should activate automatically the moment a video starts playing
- **Configurable seek step** — 1 to 600 seconds
- Runs on `<all_urls>` and inside cross-origin iframes
- Skips keypresses while typing in inputs and while modifier keys are held

## Install

### Chrome Web Store

[Install Video Controller](https://chromewebstore.google.com/detail/video-controller/odbmnkohkfnonjhklflollbpepmbdjlp)

### From source (unpacked)

1. `git clone git@github.com:CoyoteLeo/video-controller.git`
2. Open `chrome://extensions`
3. Toggle **Developer mode**
4. Click **Load unpacked** and pick the cloned folder
5. Pin the toolbar icon for quick access to the settings panel

### Packaged (.zip)

```bash
npm run zip   # produces video-controller.zip
```

Upload the resulting `video-controller.zip` to the Chrome Web Store Developer Dashboard.

## Configuration

Click the toolbar icon. The panel opens on the page with two tabs — **This page** for
live controls, **Settings** for everything global:

| Setting | Description |
| --- | --- |
| Forward / Backward | Key that seeks by the configured step |
| Volume Up / Down | Key that changes volume by ±10% |
| Play / Pause, Mute | Keys that toggle playback and audio |
| Picture in Picture | Key that toggles Chrome's native floating player |
| Theater Mode | Key that toggles the fullscreen-like overlay |
| Seek step (seconds) | How much each seek keypress moves the playhead |
| Auto Theater Mode | One domain per line. Subdomains are matched automatically (e.g. `youtube.com` covers `www.youtube.com`) |

To rebind a key: open **Settings** in the panel, click the binding, press the key. `Esc` cancels.

On a domain in the block list the panel still opens, but only on the Settings tab — otherwise
there would be no way to un-block a site from the page it applies to.

## Project Structure

```
.
├── manifest.json      # MV3 extension manifest
├── src/
│   ├── settings.js     # defaults, storage, per-domain rules, per-site memory
│   ├── transform.js    # pure: effects to CSS (unit tested)
│   ├── videos.js       # video discovery, ids, cross-frame routing
│   ├── presentation.js # owns the player's inline style; theater is one effect
│   ├── playback.js     # speed, loop, A-B repeat, frame step
│   ├── panel.js        # the whole UI: toast layer and panel layer in a shadow root
│   └── main.js         # keyboard listener, action dispatch, wiring
├── background.js      # opens the panel when the toolbar icon is clicked
├── icons/
│   ├── icon.svg       # source
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   └── icon-128.png
├── test/              # node --test, no dependencies
├── package.json       # test + zip + icon scripts
├── LICENSE
└── README.md
```

## Development

No build step — load the folder directly into Chrome. The pure layers have tests:

```bash
npm test   # node --test, no dependencies
```
 Global settings are persisted via `chrome.storage.sync`, so a change made in one tab's panel propagates to every open tab without a reload. Per-site memory lives in `chrome.storage.local`.

Regenerate PNG icons from the SVG source:

```bash
brew install librsvg   # one-time, provides rsvg-convert
npm run icons
```

## License

[MIT](LICENSE)
