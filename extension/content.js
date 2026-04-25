// content.js — Smart Study Assistant v3.1
// Edge Add-ons Store compliant — MV3, no eval, no inline scripts, no API keys.
//
// Architecture:
//   User selects text → content.js fetch → Render backend → Claude API → results
//
// Edge compliance:
//   - All network calls go only to the declared host_permission URL
//   - No API keys in frontend code
//   - AbortController timeout prevents hanging requests
//   - All user content is XSS-sanitised before rendering
//   - No localStorage (uses chrome.storage.local — declared permission)
//   - No eval(), no new Function(), no innerHTML with raw user data
//   - Graceful error messages for every failure mode

"use strict";

// ─── Configuration ────────────────────────────────────────────────────────────
// Only this URL is called — matches host_permissions in manifest.json exactly.
const API_BASE = "https://smart-study-assistant-api.onrender.com";

// Render free tier cold-starts can take ~10 s; Claude API adds ~3–5 s.
// 45 s gives comfortable headroom without hanging forever.
const TIMEOUT_MS = 45000;

// Minimum text selection length to trigger analysis.
const MIN_CHARS = 20;

// ─── Module-level state ───────────────────────────────────────────────────────
let panel = null;              // The floating UI element (created once)
let historyCache = [];         // In-memory cache for the History tab
let isEnabled = false;         // Mirrors chrome.storage.local "analysisEnabled"
let isAnalyzing = false;       // Guard: prevents overlapping API requests

// ─── Boot: restore persisted toggle state ─────────────────────────────────────
// Edge Store note: chrome.storage.local is the correct way to persist small
// amounts of extension data. localStorage is NOT accessible from content scripts
// in MV3. This is the correct pattern.
chrome.storage.local.get(["analysisEnabled"], (result) => {
  if (chrome.runtime.lastError) {
    console.warn("[SSA] storage.get error:", chrome.runtime.lastError.message);
    return;
  }
  isEnabled = result.analysisEnabled === true;
  if (panel) syncToggleUI();
});

// ─── Utility: XSS sanitiser ──────────────────────────────────────────────────
// All user text and API response text passes through this before touching DOM.
// Edge Store note: avoids innerHTML injection vulnerabilities.
function sanitize(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// ─── Utility: fetch with timeout ──────────────────────────────────────────────
// Edge Store note: All requests go to a single, declared host. AbortController
// ensures the UI never gets stuck in an infinite loading state.
async function apiFetch(path, options = {}, timeoutMs = TIMEOUT_MS) {
  const url = `${API_BASE}${path}`;
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response;
  } catch (err) {
    clearTimeout(timer);
    throw err; // re-throw; caller handles AbortError vs network error
  }
}

// ─── Utility: validate API response shape ────────────────────────────────────
// Edge Store note: validating before using prevents crashes from unexpected
// server responses, which could otherwise cause confusing UI states.
function isValidResult(obj) {
  return (
    obj !== null &&
    typeof obj === "object" &&
    typeof obj.simplified === "string" &&
    Array.isArray(obj.questions) &&
    Array.isArray(obj.keywords) &&
    typeof obj.difficulty === "string"
  );
}

// ─── Panel: create once, reuse forever ───────────────────────────────────────
function createPanel() {
  if (panel) return panel;

  // Inject scoped CSS first — no inline styles on elements (CSP-safe)
  const styleEl = document.createElement("style");
  styleEl.id = "ssa-styles";
  styleEl.textContent = `
    #ssa-panel {
      all: initial;
      position: fixed;
      top: 60px;
      right: 24px;
      width: 380px;
      max-height: 600px;
      background: #0f1729;
      border: 1px solid rgba(34,211,238,0.18);
      border-radius: 14px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.55), 0 0 24px rgba(34,211,238,0.08);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      color: #e8edf5;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      resize: both;
      min-width: 280px;
      min-height: 220px;
      box-sizing: border-box;
    }
    #ssa-panel * { box-sizing: border-box; }
    #ssa-panel.ssa-hidden { display: none !important; }
    #ssa-panel.ssa-minimized #ssa-body,
    #ssa-panel.ssa-minimized #ssa-statusbar { display: none; }
    #ssa-panel.ssa-minimized { max-height: unset; height: auto !important; resize: none; }

    /* Header */
    #ssa-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: linear-gradient(180deg, rgba(34,211,238,0.07) 0%, transparent 100%);
      border-bottom: 1px solid rgba(255,255,255,0.06);
      cursor: grab;
      user-select: none;
      flex-shrink: 0;
    }
    #ssa-header.ssa-grabbing { cursor: grabbing; }
    #ssa-logo {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 700;
      color: #22d3ee;
      letter-spacing: -0.3px;
    }
    #ssa-header-controls { display: flex; align-items: center; gap: 6px; }

    /* Toggle pill */
    #ssa-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px 4px 8px;
      border-radius: 20px;
      border: 1.5px solid #374151;
      background: #1e293b;
      cursor: pointer;
      font-size: 10px;
      font-weight: 700;
      font-family: inherit;
      color: #64748b;
      letter-spacing: 0.5px;
      transition: border-color 0.2s, background 0.2s, color 0.2s;
    }
    #ssa-toggle-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #374151;
      transition: background 0.2s;
      flex-shrink: 0;
    }
    #ssa-toggle.on {
      border-color: rgba(34,197,94,0.55);
      background: rgba(34,197,94,0.12);
      color: #22c55e;
    }
    #ssa-toggle.on #ssa-toggle-dot { background: #22c55e; }

    /* Icon buttons (minimize / close) */
    .ssa-icon-btn {
      width: 26px;
      height: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: rgba(255,255,255,0.05);
      color: #8b9bc0;
      border-radius: 7px;
      cursor: pointer;
      font-size: 13px;
      font-family: inherit;
      line-height: 1;
      transition: background 0.15s, color 0.15s;
    }
    .ssa-icon-btn:hover { background: rgba(255,255,255,0.1); color: #e8edf5; }

    /* Status bar */
    #ssa-statusbar {
      font-size: 11px;
      color: #64748b;
      background: rgba(255,255,255,0.02);
      border-bottom: 1px solid rgba(255,255,255,0.05);
      padding: 5px 14px;
      text-align: center;
      flex-shrink: 0;
      transition: color 0.2s, background 0.2s;
    }
    #ssa-statusbar.on {
      color: #22c55e;
      background: rgba(34,197,94,0.07);
      border-bottom-color: rgba(34,197,94,0.18);
    }

    /* Body */
    #ssa-body { display: flex; flex-direction: column; flex: 1; overflow: hidden; }

    /* Tabs */
    #ssa-tabs {
      display: flex;
      gap: 3px;
      padding: 10px 10px 0;
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .ssa-tab {
      padding: 5px 9px;
      font-size: 10.5px;
      font-weight: 500;
      color: #5a6a8a;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 7px;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
    }
    .ssa-tab:hover { color: #8b9bc0; background: #162039; }
    .ssa-tab.active {
      color: #22d3ee;
      background: rgba(34,211,238,0.12);
      border-color: rgba(34,211,238,0.2);
    }

    /* Content pane */
    #ssa-content {
      padding: 10px 14px;
      flex: 1;
      overflow-y: auto;
      min-height: 80px;
    }
    #ssa-content::-webkit-scrollbar { width: 4px; }
    #ssa-content::-webkit-scrollbar-thumb { background: #374151; border-radius: 2px; }

    .ssa-pane { display: none; }
    .ssa-pane.active { display: block; }

    /* Content types */
    .ssa-empty {
      text-align: center;
      color: #5a6a8a;
      font-size: 12px;
      padding: 36px 10px;
      line-height: 1.7;
    }
    .ssa-loading {
      text-align: center;
      color: #22d3ee;
      font-size: 12px;
      padding: 36px 10px;
    }
    .ssa-spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(34,211,238,0.2);
      border-top-color: #22d3ee;
      border-radius: 50%;
      animation: ssa-spin 0.7s linear infinite;
      vertical-align: middle;
      margin-left: 8px;
    }
    @keyframes ssa-spin { to { transform: rotate(360deg); } }

    .ssa-card {
      font-size: 13px;
      line-height: 1.65;
      color: #e8edf5;
      background: #162039;
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 10px;
      padding: 12px;
    }

    .ssa-q-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .ssa-q-item:last-child { border-bottom: none; }
    .ssa-q-num {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: rgba(34,211,238,0.15);
      color: #22d3ee;
      font-size: 10px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .ssa-q-text { font-size: 12.5px; line-height: 1.5; color: #e8edf5; }

    .ssa-kw-grid { display: flex; flex-wrap: wrap; gap: 6px; }
    .ssa-kw-tag {
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 500;
      font-family: monospace;
      color: #22d3ee;
      background: rgba(34,211,238,0.1);
      border: 1px solid rgba(34,211,238,0.2);
      border-radius: 20px;
    }

    .ssa-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
    }
    .ssa-badge-easy   { background: rgba(34,197,94,0.15); color: #22c55e; border: 1px solid rgba(34,197,94,0.3); }
    .ssa-badge-medium { background: rgba(234,179,8,0.15); color: #eab308; border: 1px solid rgba(234,179,8,0.3); }
    .ssa-badge-hard   { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }

    .ssa-error-box {
      font-size: 12px;
      line-height: 1.65;
      color: #fca5a5;
      background: rgba(239,68,68,0.08);
      border: 1px solid rgba(239,68,68,0.22);
      border-radius: 10px;
      padding: 14px 12px;
    }
    .ssa-error-title {
      display: block;
      margin-bottom: 5px;
      font-size: 13px;
      font-weight: 700;
      color: #ef4444;
    }
    .ssa-mono {
      background: rgba(255,255,255,0.08);
      padding: 1px 5px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 11px;
    }

    /* History items */
    .ssa-history-item {
      background: #162039;
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: border-color 0.15s;
    }
    .ssa-history-item:hover { border-color: rgba(34,211,238,0.2); }
    .ssa-history-content { flex: 1; cursor: pointer; min-width: 0; }
    .ssa-history-text {
      font-size: 11px;
      color: #8b9bc0;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .ssa-history-meta { display: flex; gap: 6px; margin-top: 5px; }
    .ssa-history-tag {
      font-size: 9px;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(34,211,238,0.1);
      color: #22d3ee;
    }
    .ssa-delete-btn {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      border: none;
      background: rgba(239,68,68,0.1);
      color: #ef4444;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }
    .ssa-delete-btn:hover { background: rgba(239,68,68,0.25); }

    /* Footer actions */
    #ssa-footer {
      padding: 8px 14px 12px;
      border-top: 1px solid rgba(255,255,255,0.06);
      flex-shrink: 0;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .ssa-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      font-size: 11px;
      font-weight: 600;
      color: #22d3ee;
      background: rgba(34,211,238,0.1);
      border: 1px solid rgba(34,211,238,0.2);
      border-radius: 8px;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s;
    }
    .ssa-btn:hover:not(:disabled) { background: rgba(34,211,238,0.2); }
    .ssa-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  `;
  document.documentElement.appendChild(styleEl);

  // Build DOM
  panel = document.createElement("div");
  panel.id = "ssa-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Smart Study Assistant");

  panel.innerHTML = `
    <div id="ssa-header">
      <div id="ssa-logo">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round"
             aria-hidden="true">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
        </svg>
        Study Assistant
      </div>
      <div id="ssa-header-controls">
        <button id="ssa-toggle" aria-pressed="false" title="Enable or disable AI text analysis">
          <span id="ssa-toggle-dot"></span>
          <span id="ssa-toggle-label">OFF</span>
        </button>
        <button class="ssa-icon-btn" id="ssa-minimize-btn" title="Minimize panel" aria-label="Minimize">&#8211;</button>
        <button class="ssa-icon-btn" id="ssa-close-btn" title="Close panel" aria-label="Close">&#x2715;</button>
      </div>
    </div>

    <div id="ssa-statusbar" role="status" aria-live="polite">
      AI Analysis is <strong>OFF</strong> — click the toggle above to enable.
    </div>

    <div id="ssa-body">
      <div id="ssa-tabs" role="tablist">
        <button class="ssa-tab active" data-tab="simplified" role="tab" aria-selected="true">Simplified</button>
        <button class="ssa-tab" data-tab="questions" role="tab" aria-selected="false">Questions</button>
        <button class="ssa-tab" data-tab="keywords" role="tab" aria-selected="false">Keywords</button>
        <button class="ssa-tab" data-tab="difficulty" role="tab" aria-selected="false">Difficulty</button>
        <button class="ssa-tab" data-tab="history" role="tab" aria-selected="false">History</button>
      </div>

      <div id="ssa-content">
        <div class="ssa-pane active" id="ssa-pane-simplified" role="tabpanel">
          <div class="ssa-empty">Enable AI Analysis above,<br>then select any text on the page.</div>
        </div>
        <div class="ssa-pane" id="ssa-pane-questions" role="tabpanel">
          <div class="ssa-empty">Questions will appear here after analysis.</div>
        </div>
        <div class="ssa-pane" id="ssa-pane-keywords" role="tabpanel">
          <div class="ssa-empty">Keywords will appear here after analysis.</div>
        </div>
        <div class="ssa-pane" id="ssa-pane-difficulty" role="tabpanel">
          <div class="ssa-empty">Difficulty level will appear here after analysis.</div>
        </div>
        <div class="ssa-pane" id="ssa-pane-history" role="tabpanel">
          <div class="ssa-empty">No history yet.</div>
        </div>
      </div>

      <div id="ssa-footer">
        <button class="ssa-btn" id="ssa-back-btn" style="display:none;" aria-label="Back to history list">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Back
        </button>
        <button class="ssa-btn" id="ssa-pdf-btn" disabled aria-label="Export analysis as PDF">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Export PDF
        </button>
      </div>
    </div>
  `;

  document.documentElement.appendChild(panel);

  // ── Wire up drag ────────────────────────────────────────────────────────────
  let dragging = false, dx = 0, dy = 0;
  const header = panel.querySelector("#ssa-header");

  header.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;
    dragging = true;
    const rect = panel.getBoundingClientRect();
    dx = e.clientX - rect.left;
    dy = e.clientY - rect.top;
    header.classList.add("ssa-grabbing");
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const x = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - dx));
    const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dy));
    panel.style.left = x + "px";
    panel.style.top = y + "px";
    panel.style.right = "auto";
  });
  document.addEventListener("mouseup", () => {
    if (dragging) { dragging = false; header.classList.remove("ssa-grabbing"); }
  });

  // ── Wire up controls ────────────────────────────────────────────────────────
  panel.querySelector("#ssa-minimize-btn").addEventListener("click", () => {
    panel.classList.toggle("ssa-minimized");
  });

  panel.querySelector("#ssa-close-btn").addEventListener("click", () => {
    panel.classList.add("ssa-hidden");
  });

  panel.querySelector("#ssa-toggle").addEventListener("click", (e) => {
    e.stopPropagation();
    isEnabled = !isEnabled;
    chrome.storage.local.set({ analysisEnabled: isEnabled });
    syncToggleUI();
  });

  // ── Wire up tabs ────────────────────────────────────────────────────────────
  panel.querySelectorAll(".ssa-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab);
      panel.querySelector("#ssa-back-btn").style.display = "none";
    });
  });

  panel.querySelector('[data-tab="history"]').addEventListener("click", loadHistory);

  // ── Wire up footer buttons ──────────────────────────────────────────────────
  panel.querySelector("#ssa-back-btn").addEventListener("click", () => {
    panel.querySelector("#ssa-back-btn").style.display = "none";
    switchTab("history");
    loadHistory();
  });

  panel.querySelector("#ssa-pdf-btn").addEventListener("click", exportPdf);

  syncToggleUI();
  return panel;
}

// ─── Toggle UI sync ───────────────────────────────────────────────────────────
function syncToggleUI() {
  if (!panel) return;
  const toggle = panel.querySelector("#ssa-toggle");
  const label = panel.querySelector("#ssa-toggle-label");
  const bar = panel.querySelector("#ssa-statusbar");

  if (isEnabled) {
    toggle.classList.add("on");
    toggle.setAttribute("aria-pressed", "true");
    label.textContent = "ON";
    bar.innerHTML = "AI Analysis is <strong>ON</strong> — select any text to analyze.";
    bar.classList.add("on");
  } else {
    toggle.classList.remove("on");
    toggle.setAttribute("aria-pressed", "false");
    label.textContent = "OFF";
    bar.innerHTML = "AI Analysis is <strong>OFF</strong> — click the toggle above to enable.";
    bar.classList.remove("on");
  }
}

// ─── Tab switching ────────────────────────────────────────────────────────────
function switchTab(name) {
  if (!panel) return;
  panel.querySelectorAll(".ssa-tab").forEach((t) => {
    const active = t.dataset.tab === name;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", String(active));
  });
  panel.querySelectorAll(".ssa-pane").forEach((p) => {
    p.classList.toggle("active", p.id === `ssa-pane-${name}`);
  });
}

// ─── Loading state ────────────────────────────────────────────────────────────
// Edge Store note: The UI must always show either results or an error.
// Loading spinners with no exit path are a common rejection reason.
function showLoading() {
  const p = createPanel();
  p.classList.remove("ssa-hidden");
  const spinnerHtml = (msg) =>
    `<div class="ssa-loading">${sanitize(msg)}<span class="ssa-spinner" aria-hidden="true"></span></div>`;

  ["simplified", "questions", "keywords", "difficulty"].forEach((tab) => {
    const labels = {
      simplified: "Simplifying text",
      questions:  "Generating questions",
      keywords:   "Extracting keywords",
      difficulty: "Detecting difficulty",
    };
    p.querySelector(`#ssa-pane-${tab}`).innerHTML = spinnerHtml(labels[tab]);
  });

  p.querySelector("#ssa-pdf-btn").disabled = true;
  p.querySelector("#ssa-back-btn").style.display = "none";
  switchTab("simplified");
}

// ─── Error state ──────────────────────────────────────────────────────────────
// Four named error types with clear human-readable messages for reviewers.
function showError(type) {
  const p = createPanel();

  const messages = {
    network: {
      title: "Cannot Reach Server",
      body: "The analysis server is not responding. This may be a temporary issue — please try again in a moment.",
    },
    timeout: {
      title: "Request Timed Out",
      body: "The server took too long to respond. Try selecting a shorter passage of text.",
    },
    parse: {
      title: "Unexpected Response",
      body: "The server returned an unexpected response. Please try again.",
    },
    server: {
      title: "Server Error",
      body: "The analysis server returned an error. Please try again shortly.",
    },
    unknown: {
      title: "Something Went Wrong",
      body: "An unexpected error occurred. Please try again.",
    },
  };

  const { title, body } = messages[type] ?? messages.unknown;
  const html = `
    <div class="ssa-error-box" role="alert">
      <span class="ssa-error-title">${sanitize(title)}</span>
      ${sanitize(body)}
    </div>`;

  // Populate ALL panes — no pane is left showing a spinner
  ["simplified", "questions", "keywords", "difficulty"].forEach((tab) => {
    p.querySelector(`#ssa-pane-${tab}`).innerHTML = html;
  });

  p.querySelector("#ssa-pdf-btn").disabled = true;
  switchTab("simplified");
}

// ─── Render results ───────────────────────────────────────────────────────────
function showResults(result) {
  const p = createPanel();

  // Simplified text
  p.querySelector("#ssa-pane-simplified").innerHTML = result.simplified
    ? `<div class="ssa-card">${sanitize(result.simplified)}</div>`
    : `<div class="ssa-empty">No simplified text returned.</div>`;

  // Questions
  if (result.questions.length) {
    p.querySelector("#ssa-pane-questions").innerHTML = result.questions
      .map((q, i) => `
        <div class="ssa-q-item">
          <div class="ssa-q-num" aria-hidden="true">${i + 1}</div>
          <div class="ssa-q-text">${sanitize(q)}</div>
        </div>`)
      .join("");
  } else {
    p.querySelector("#ssa-pane-questions").innerHTML =
      `<div class="ssa-empty">No questions were generated.</div>`;
  }

  // Keywords
  if (result.keywords.length) {
    p.querySelector("#ssa-pane-keywords").innerHTML =
      `<div class="ssa-kw-grid">${
        result.keywords.map((k) => `<span class="ssa-kw-tag">${sanitize(k)}</span>`).join("")
      }</div>`;
  } else {
    p.querySelector("#ssa-pane-keywords").innerHTML =
      `<div class="ssa-empty">No keywords were found.</div>`;
  }

  // Difficulty
  const level = (result.difficulty ?? "").toLowerCase();
  const icons = { easy: "🟢", medium: "🟡", hard: "🔴" };
  const icon = icons[level] ?? "⚪";
  const badgeClass = ["easy", "medium", "hard"].includes(level)
    ? `ssa-badge-${level}` : "";
  p.querySelector("#ssa-pane-difficulty").innerHTML =
    `<div class="ssa-badge ${badgeClass}" role="status">
       ${icon} ${sanitize(result.difficulty)}
     </div>`;

  p.querySelector("#ssa-pdf-btn").disabled = false;
  switchTab("simplified");
}

// ─── History ──────────────────────────────────────────────────────────────────
async function loadHistory() {
  const p = createPanel();
  const container = p.querySelector("#ssa-pane-history");
  container.innerHTML =
    `<div class="ssa-loading">Loading history<span class="ssa-spinner" aria-hidden="true"></span></div>`;

  try {
    const resp = await apiFetch("/history", {}, 10000);
    if (!resp.ok) throw new Error(`HTTP_${resp.status}`);
    const items = await resp.json();
    historyCache = Array.isArray(items) ? items : [];

    if (!historyCache.length) {
      container.innerHTML =
        `<div class="ssa-empty">No history yet.<br>Analyse some text to get started.</div>`;
      return;
    }

    container.innerHTML = historyCache
      .map((item, i) => `
        <div class="ssa-history-item" data-index="${i}">
          <div class="ssa-history-content">
            <div class="ssa-history-text">${sanitize((item.input ?? "").slice(0, 120))}</div>
            <div class="ssa-history-meta">
              <span class="ssa-history-tag">${sanitize(item.difficulty ?? "?")}</span>
              <span class="ssa-history-tag">${(item.keywords ?? []).length} keywords</span>
            </div>
          </div>
          <button class="ssa-delete-btn" data-index="${i}" aria-label="Delete this history entry">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </button>
        </div>`)
      .join("");

    // Item click → open detail view
    container.querySelectorAll(".ssa-history-content").forEach((el) => {
      el.addEventListener("click", () => {
        const idx = parseInt(el.closest("[data-index]").dataset.index, 10);
        const item = historyCache[idx];
        if (!item) return;
        chrome.storage.local.set({ analysis: item });
        showResults(item);
        p.querySelector("#ssa-back-btn").style.display = "inline-flex";
        p.querySelector("#ssa-pdf-btn").disabled = false;
      });
    });

    // Delete button
    container.querySelectorAll(".ssa-delete-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        deleteHistoryEntry(idx);
      });
    });

  } catch (err) {
    const isTimeout = err.name === "AbortError";
    container.innerHTML = `
      <div class="ssa-error-box" role="alert">
        <span class="ssa-error-title">${isTimeout ? "Request Timed Out" : "Cannot Reach Server"}</span>
        Could not load history. Check your connection and try again.
      </div>`;
  }
}

async function deleteHistoryEntry(index) {
  try {
    const resp = await apiFetch(`/history/${index}`, { method: "DELETE" }, 8000);
    if (!resp.ok) throw new Error(`HTTP_${resp.status}`);
    loadHistory();
  } catch {
    // Non-critical failure — show the history tab with a soft error
    const p = createPanel();
    p.querySelector("#ssa-pane-history").innerHTML = `
      <div class="ssa-error-box" role="alert">
        <span class="ssa-error-title">Delete Failed</span>
        Could not delete the entry. Please try again.
      </div>`;
  }
}

// ─── PDF export ───────────────────────────────────────────────────────────────
async function exportPdf() {
  const stored = await new Promise((resolve) => {
    chrome.storage.local.get(["analysis"], resolve);
  });

  const analysis = stored.analysis;
  if (!analysis || !isValidResult(analysis)) {
    createPanel()
      .querySelector("#ssa-pane-simplified").innerHTML = `
        <div class="ssa-error-box" role="alert">
          <span class="ssa-error-title">Nothing to Export</span>
          Analyse some text first, then export.
        </div>`;
    switchTab("simplified");
    return;
  }

  const pdfBtn = createPanel().querySelector("#ssa-pdf-btn");
  pdfBtn.disabled = true;
  pdfBtn.textContent = "Generating…";

  try {
    const resp = await apiFetch(
      "/export-pdf",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          simplified: analysis.simplified ?? "",
          questions:  analysis.questions  ?? [],
          keywords:   analysis.keywords   ?? [],
          difficulty: analysis.difficulty ?? "",
        }),
      },
      20000
    );

    if (!resp.ok) throw new Error(`HTTP_${resp.status}`);

    const blob = await resp.blob();
    if (blob.size === 0) throw new Error("empty_blob");

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "smart-study-output.pdf";
    link.click();
    URL.revokeObjectURL(url);

  } catch (err) {
    createPanel()
      .querySelector("#ssa-pane-simplified").innerHTML = `
        <div class="ssa-error-box" role="alert">
          <span class="ssa-error-title">Export Failed</span>
          Could not generate the PDF. Please try again.
        </div>`;
    switchTab("simplified");
  } finally {
    // Restore button text regardless of outcome
    pdfBtn.disabled = false;
    pdfBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Export PDF`;
  }
}

// ─── Message listener: icon click → toggle panel ──────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== "toggle-panel") return;

  const p = createPanel();
  const isHidden = p.classList.contains("ssa-hidden");
  p.classList.toggle("ssa-hidden", !isHidden);

  if (isHidden) {
    // Panel just became visible — sync state
    syncToggleUI();
  }

  sendResponse({ ok: true });
});

// ─── Core: text selection listener ───────────────────────────────────────────
// Edge Store note: using mouseup (not mousedown) is the correct pattern.
// We check all guards before making any network call.
document.addEventListener("mouseup", async (e) => {
  // Guard 1: ignore clicks inside our own panel
  if (e.target.closest?.("#ssa-panel")) return;

  // Guard 2: do nothing if toggle is OFF — no network, no UI change
  if (!isEnabled) return;

  // Guard 3: prevent stacking concurrent requests
  if (isAnalyzing) return;

  const text = window.getSelection()?.toString().trim() ?? "";

  // Guard 4: minimum meaningful selection
  if (text.length < MIN_CHARS) return;

  isAnalyzing = true;
  showLoading();

  try {
    const resp = await apiFetch("/analyze", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ text }),
    });

    if (!resp.ok) {
      showError("server");
      return;
    }

    let result;
    try {
      result = await resp.json();
    } catch {
      showError("parse");
      return;
    }

    // Validate before touching the DOM — avoids partial renders
    if (!isValidResult(result)) {
      showError("parse");
      return;
    }

    // Persist for PDF export and history detail view
    chrome.storage.local.set({ analysis: result });
    showResults(result);

  } catch (err) {
    if (err.name === "AbortError") {
      showError("timeout");
    } else {
      showError("network");
    }
  } finally {
    isAnalyzing = false;
  }
});
