# Video Controller

<p align="center">
  <img src="icons/icon-128.png" alt="Video Controller icon" width="96" height="96" />
</p>

A minimalist Chrome extension that gives every HTML5 video on the web a consistent, configurable keyboard remote — plus a one-key **Theater Mode** and a domain allowlist that enables it automatically.

## Features

- **Seek** forward / backward with any key (default: `→` / `←`)
- **Volume** up / down with any key (default: `↑` / `↓`)
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

Click the toolbar icon to open the panel:

| Setting | Description |
| --- | --- |
| Forward / Backward | Key that seeks by the configured step |
| Volume Up / Down | Key that changes volume by ±10% |
| Theater Mode | Key that toggles the fullscreen-like overlay |
| Seek step (seconds) | How much each seek keypress moves the playhead |
| Auto Theater Mode | One domain per line. Subdomains are matched automatically (e.g. `youtube.com` covers `www.youtube.com`) |

To rebind a key: click the button, press the key. `Esc` cancels.

## Project Structure

```
.
├── manifest.json      # MV3 extension manifest
├── content.js         # keyboard listener, theater overlay, auto-theater
├── popup.html         # settings panel UI
├── popup.js           # settings panel logic
├── icons/
│   ├── icon.svg       # source
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   └── icon-128.png
├── package.json       # zip + icon regeneration scripts
├── LICENSE
└── README.md
```

## Development

No build step — load the folder directly into Chrome. Settings are persisted via `chrome.storage.sync`, so changes in the popup propagate to every open tab without a reload.

Regenerate PNG icons from the SVG source:

```bash
brew install librsvg   # one-time, provides rsvg-convert
npm run icons
```

## License

[MIT](LICENSE)
