// background.js — Service worker for Smart Study Assistant MV3
// Handles extension icon click → toggles the in-page panel.

chrome.action.onClicked.addListener((tab) => {
  // Guard: only works on http/https pages
  if (
    !tab.id ||
    !tab.url ||
    (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))
  ) {
    console.warn("[SSA background] Cannot inject into this tab:", tab.url);
    return;
  }

  // Send toggle to the already-running content script.
  // If it fails (tab opened before extension install), inject THEN show — never toggle twice.
  // Key fix: after injection we send "show-panel" (always shows) NOT "toggle-panel"
  // (which would toggle an already-visible panel back to hidden on the 2nd call).
  chrome.tabs.sendMessage(tab.id, { action: "toggle-panel" }, () => {
    if (chrome.runtime.lastError) {
      // Content script not alive yet — inject it, then explicitly SHOW the panel.
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
          // Give content script time to boot (storage.get + DOM setup)
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, { action: "show-panel" });
          }, 250);
        }
      );
    }
  });
});
