// background.js — Service worker for Smart Study Assistant MV3
//
// Responsibilities:
//   1. Extension icon click → toggle the in-page panel
//   2. PDF interception → redirect PDF URLs to our custom viewer
//      so that pdf_viewer.js can run on it and text selection works.
//   3. FEATURE 2: Keyboard shortcut (Alt+S) → toggle panel in active tab.
//      Reads chrome.storage.sync to check the PDF-redirect toggle.
//
// BUG FIX: The original code used chrome.webRequest.onHeadersReceived with
// a `redirectUrl` return value. In Manifest V3, webRequest is NON-BLOCKING —
// returning a value from the listener does nothing. The redirect never fired
// for PDFs that lack a .pdf extension (e.g. university portals, Google Drive).
// Replaced with a proper chrome.tabs.update() call inside the listener, which
// IS supported in MV3 service workers.

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
      !tab.url.startsWith("https://") &&
      !tab.url.startsWith("chrome-extension://"))
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

// ── 3. PDF interception ───────────────────────────────────────────────────────
// Intercept PDFs and redirect to our custom pdf_viewer.html which uses PDF.js
// to render them with a proper selectable text layer.
//
// FEATURE 6: Reads the "pdfRedirectEnabled" setting from chrome.storage.sync.
// If the user has disabled PDF auto-redirect in the options page, we skip it.

const VIEWER_URL = chrome.runtime.getURL("pdf_viewer.html");

function isOurViewer(url) {
  return url.startsWith(VIEWER_URL);
}

function looksLikePdf(url) {
  try {
    const u = new URL(url);
    return u.pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

// Fast path: intercept by URL .pdf extension
chrome.webNavigation.onBeforeNavigate.addListener(
  (details) => {
    if (details.frameId !== 0) return; // top-level only
    if (isOurViewer(details.url)) return;
    if (!looksLikePdf(details.url)) return;

    // FEATURE 6: check the PDF redirect toggle before intercepting
    chrome.storage.sync.get({ pdfRedirectEnabled: true }, (settings) => {
      if (!settings.pdfRedirectEnabled) return;
      const redirectTo = `${VIEWER_URL}?file=${encodeURIComponent(details.url)}`;
      console.log("[SSA background] Intercepting PDF →", details.url);
      chrome.tabs.update(details.tabId, { url: redirectTo });
    });
  },
  { url: [{ schemes: ["http", "https", "file"] }] }
);

// Slow path: intercept by Content-Type header (PDFs without .pdf extension).
//
// BUG FIX: In MV3, webRequest listeners are OBSERVATIONAL only — you cannot
// return { redirectUrl } to block/redirect. The original code attempted this
// and silently failed. We now call chrome.tabs.update() instead, which works.
//
// NOTE: This fires AFTER the server has already started streaming the PDF.
// Chrome will show the PDF briefly before we redirect. This is a MV3 limitation;
// declarativeNetRequest rules (DNR) are the proper solution but require
// static rule files with known URLs. For a dynamic redirect like ours,
// tabs.update() is the only viable MV3 approach.
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    if (isOurViewer(details.url)) return;
    if (details.type !== "main_frame") return;
    // Skip if URL already ends with .pdf (already handled above)
    if (looksLikePdf(details.url)) return;

    const contentType =
      details.responseHeaders?.find(
        (h) => h.name.toLowerCase() === "content-type"
      )?.value ?? "";

    if (!contentType.includes("application/pdf")) return;

    // FEATURE 6: check the PDF redirect toggle before intercepting
    chrome.storage.sync.get({ pdfRedirectEnabled: true }, (settings) => {
      if (!settings.pdfRedirectEnabled) return;
      const redirectTo = `${VIEWER_URL}?file=${encodeURIComponent(details.url)}`;
      console.log("[SSA background] PDF by content-type →", details.url);
      // MV3 FIX: use tabs.update() — returning redirectUrl does NOT work in MV3
      chrome.tabs.update(details.tabId, { url: redirectTo });
    });
  },
  { urls: ["<all_urls>"], types: ["main_frame"] },
  ["responseHeaders", "extraHeaders"]
);
