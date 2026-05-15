// options.js — Settings page logic for Smart Study Assistant
//
// Reads and writes two settings to chrome.storage.sync:
//   apiBase  (string) — backend URL, default the hosted Render URL
//   maxChars (number) — max chars to send, default 5000
//
// content.js reads apiBase and maxChars on boot.

"use strict";

const DEFAULTS = {
  apiBase:  "https://smart-study-assistant-9u6m.onrender.com",
  maxChars: 5000,
};

const apiBaseInput  = document.getElementById("api-base");
const maxCharsInput = document.getElementById("max-chars");
const saveBtn       = document.getElementById("save-btn");
const statusMsg     = document.getElementById("status-msg");

// ── Load saved settings into the form on page open ───────────────────────────
chrome.storage.sync.get(DEFAULTS, (settings) => {
  apiBaseInput.value  = settings.apiBase;
  maxCharsInput.value = settings.maxChars;
});

// ── Save on button click ──────────────────────────────────────────────────────
saveBtn.addEventListener("click", () => {
  const apiBase  = apiBaseInput.value.trim() || DEFAULTS.apiBase;
  const maxChars = parseInt(maxCharsInput.value, 10) || DEFAULTS.maxChars;

  // Basic URL validation
  try {
    new URL(apiBase);
  } catch {
    showStatus("⚠ Invalid URL — please enter a valid backend URL.", false);
    return;
  }

  chrome.storage.sync.set({ apiBase, maxChars }, () => {
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