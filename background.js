// action.onClicked only fires when the action has no default_popup, which is the
// point: one click on the icon opens the panel instead of opening a menu that
// contains a button that opens the panel.
const MSG_TAG = '__video_controller_v1__';

chrome.action.onClicked.addListener((tab) => {
  if (!tab || tab.id === undefined) return;
  chrome.tabs.sendMessage(tab.id, { tag: MSG_TAG, type: 'open-panel' }, () => {
    // No content script on this tab (a chrome:// page, the Web Store, a PDF).
    // Nothing to open and nothing to report — swallow the lastError rather than
    // letting it surface as an unchecked runtime error.
    void chrome.runtime.lastError;
  });
});
