# Privacy Policy

_Last updated: 2026-04-19_

**Video Controller** is a browser extension that adds configurable keyboard
controls to HTML5 `<video>` elements on web pages.

## What data we collect

**None.** Video Controller does not collect, transmit, sell, or share any
personal information, browsing history, video content, or identifiable user
data.

## What data is stored locally

The extension saves the following settings using the browser's
[`chrome.storage.sync`](https://developer.chrome.com/docs/extensions/reference/api/storage)
API, which keeps them in your own browser profile and — if you are signed
into Chrome — synchronises them across your own devices via your Google
account:

- The keys you assigned to each action (forward, backward, volume up,
  volume down, theater mode)
- The seek step in seconds
- The list of domains on which Theater Mode should auto-activate

This data never leaves your own Google account. The extension has no backend
server and makes no network requests.

## Host permissions (`<all_urls>`)

The extension runs a content script on every page so it can detect `<video>`
elements and apply keyboard controls. It does **not** read the content of web
pages, extract text, monitor browsing activity, or communicate with any
external service.

## Remote code

Video Controller contains no remote code. All JavaScript is bundled inside
the extension package and reviewed as part of the Chrome Web Store submission.

## Contact

Questions or concerns: open an issue at
<https://github.com/CoyoteLeo/video-controller/issues>.
