// options.js — Settings page logic for Smart Study Assistant
//
// Reads and writes three settings to chrome.storage.sync:
//   apiBase          (string)  — backend URL, default "http://127.0.0.1:8000"
//   maxChars         (number)  — max chars to send, default 5000
//   pdfRedirectEnabled (bool)  — whether to intercept PDF navigations, default true
//
// content.js reads apiBase and maxChars on boot.
// background.js reads pdfRedirectEnabled before intercepting PDF navigations.

"use strict";

const DEFAULTS = {
  apiBase:           "http://127.0.0.1:8000",
  maxChars:          5000,
  pdfRedirectEnabled: true,
};

const apiBaseInput   = document.getElementById("api-base");
const maxCharsInput  = document.getElementById("max-chars");
const pdfRedirectCb  = document.getElementById("pdf-redirect");
const saveBtn        = document.getElementById("save-btn");
const statusMsg      = document.getElementById("status-msg");

// ── Load saved settings into the form on page open ───────────────────────────
chrome.storage.sync.get(DEFAULTS, (settings) => {
  apiBaseInput.value     = settings.apiBase;
  maxCharsInput.value    = settings.maxChars;
  pdfRedirectCb.checked  = settings.pdfRedirectEnabled;
});

// ── Save on button click ──────────────────────────────────────────────────────
saveBtn.addEventListener("click", () => {
  const apiBase  = apiBaseInput.value.trim() || DEFAULTS.apiBase;
  const maxChars = parseInt(maxCharsInput.value, 10) || DEFAULTS.maxChars;
  const pdfRedirectEnabled = pdfRedirectCb.checked;

  // Basic URL validation
  try {
    new URL(apiBase);
  } catch {
    showStatus("⚠ Invalid URL — please enter a valid backend URL.", false);
    return;
  }

  chrome.storage.sync.set({ apiBase, maxChars, pdfRedirectEnabled }, () => {
    if (chrome.runtime.lastError) {
      showStatus("⚠ Could not save settings: " + chrome.runtime.lastError.message, false);
      return;
    }
    showStatus("✓ Settings saved!", true);
  });
});

function showStatus(msg, success) {
  statusMsg.textContent = msg;
  statusMsg.style.color = success ? "#22c55e" : "#ef4444";
  statusMsg.classList.remove("hidden");
  setTimeout(() => { statusMsg.classList.add("hidden"); }, 3000);
}
