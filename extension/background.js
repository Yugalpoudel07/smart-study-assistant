// background.js — Service worker for Smart Study Assistant MV3
// Handles extension icon click → toggles the in-page panel.

chrome.action.onClicked.addListener((tab) => {
  // Guard: only works on http/https pages (not chrome://, edge://, etc.)
  if (
    !tab.id ||
    !tab.url ||
    (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))
  ) {
    console.warn("[SSA background] Cannot inject into this tab:", tab.url);
    return;
  }

  // Try to send toggle message to already-running content script
  chrome.tabs.sendMessage(tab.id, { action: "toggle-panel" }, () => {
    if (chrome.runtime.lastError) {
      // Content script not yet alive on this tab (e.g. tab was open before
      // extension install). Programmatically inject, then re-send.
      chrome.scripting.executeScript(
        { target: { tabId: tab.id }, files: ["content.js"] },
        () => {
          if (chrome.runtime.lastError) {
            console.error(
              "[SSA background] Inject failed:",
              chrome.runtime.lastError.message
            );
            return;
          }
          // Small delay lets content script finish its storage.get() boot call
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, { action: "toggle-panel" });
          }, 150);
        }
      );
    }
  });
});
