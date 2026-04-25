// background.js — Service Worker for Smart Study Assistant (MV3)
//
// Responsibilities:
//   1. Listen for the extension icon click
//   2. Toggle the in-page content script panel
//   3. Inject content.js on tabs that were open before install
//
// Edge Store compliance notes:
//   - No network requests made here (all API calls are in content.js)
//   - No eval(), no inline scripts
//   - Guards against non-http/https tabs (chrome://, edge://, etc.)
//   - All chrome API errors explicitly handled

"use strict";

chrome.action.onClicked.addListener((tab) => {
  // Guard: content scripts cannot run on browser internal pages
  if (
    !tab.id ||
    !tab.url ||
    (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))
  ) {
    console.warn("[SSA] Cannot inject into this tab:", tab?.url ?? "unknown");
    return;
  }

  // Attempt to message the already-running content script
  chrome.tabs.sendMessage(tab.id, { action: "toggle-panel" }, () => {
    if (!chrome.runtime.lastError) {
      // Content script was alive — message delivered successfully
      return;
    }

    // Content script not yet alive on this tab (tab was open before install,
    // or navigated to a new page). Inject it programmatically.
    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, files: ["content.js"] },
      () => {
        if (chrome.runtime.lastError) {
          console.error("[SSA] Script injection failed:", chrome.runtime.lastError.message);
          return;
        }

        // Wait briefly for content.js to initialise its chrome.storage.local read,
        // then send the toggle message.
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, { action: "toggle-panel" }, () => {
            if (chrome.runtime.lastError) {
              console.warn("[SSA] Post-inject message failed:", chrome.runtime.lastError.message);
            }
          });
        }, 200);
      }
    );
  });
});
