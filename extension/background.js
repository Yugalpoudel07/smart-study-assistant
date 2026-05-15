// background.js — Service worker for Smart Study Assistant MV3
//
// Responsibilities:
//   1. Extension icon click → toggle the in-page panel
//   2. FEATURE 2: Keyboard shortcut (Alt+S) → toggle panel in active tab.

"use strict";

// ── 1. Icon click → toggle panel ─────────────────────────────────────────────
chrome.action.onClicked.addListener((tab) => {
  _togglePanelInTab(tab);
});

// ── 2. FEATURE 2: Keyboard shortcut → toggle panel ───────────────────────────
// manifest.json declares the "toggle-panel-shortcut" command (Alt+S).
// When triggered, we forward a "toggle-panel" message to the active tab.
chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-panel-shortcut") return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs.length) return;
    _togglePanelInTab(tabs[0]);
  });
});

// ── Shared helper: send toggle-panel to a tab, injecting content.js if needed ─
function _togglePanelInTab(tab) {
  if (
    !tab.id ||
    !tab.url ||
    (!tab.url.startsWith("http://") &&
      !tab.url.startsWith("https://"))
  ) {
    console.warn("[SSA background] Cannot inject into this tab:", tab.url);
    return;
  }

  chrome.tabs.sendMessage(tab.id, { action: "toggle-panel" }, () => {
    if (chrome.runtime.lastError) {
      // Content script not yet injected — inject it then show panel
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
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, { action: "show-panel" });
          }, 250);
        }
      );
    }
  });
}