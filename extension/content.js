// ===== Smart Study Assistant — Double-Injection Guard =====
// content.js is declared in manifest content_scripts AND injected manually
// by background.js via chrome.scripting.executeScript when the content script
// hasn't loaded yet. On some pages both fire, causing:
//   SyntaxError: Identifier 'API_BASE' has already been declared
// The guard below makes the entire script a no-op on the second injection.

if (typeof window.__SSA_INJECTED__ === 'undefined') {
window.__SSA_INJECTED__ = true;

// ===== Smart Study Assistant v3.2 =====
// Changes vs v3.1:
//   BUG FIX  (BUG 5)  : fetchWithTimeout renamed to fetchAPI with real
//                        AbortController timeout of 120 s.  Shows a friendly
//                        timeout message in the panel if it fires.
//   BUG FIX  (BUG 6)  : MAX_CHARS = 5000 cap after the 20-char minimum.
//                        Truncated text shows a one-line notice in the status bar.
//   BUG FIX  (BUG 10) : History items use data-id (UUID) instead of data-index.
//                        deleteHistoryItem() sends the entry's id field.
//   FEATURE 1          : Offline/reconnect UX — error shown once per session;
//                        "Retry" button re-attempts the last analysis.
//   FEATURE 2          : Keyboard shortcut (Alt+S) — documented in status bar.
//   FEATURE 3          : History search — client-side filter input above history list.
//   FEATURE 4          : "Export MD" button — client-side Markdown download.
//   FEATURE 5          : Status bar shows "Analyzed N chars · Difficulty · K keywords"
//                        after a successful analysis.
//   FEATURE 6          : API_BASE and MAX_CHARS read from chrome.storage.sync on boot.

"use strict";

// ─── Constants (defaults overridden by options page via chrome.storage.sync) ──
let API_BASE = "http://127.0.0.1:8000";
let MAX_CHARS = 5000; // BUG 6: cap on text sent to backend

// ─── Module state ────────────────────────────────────────────────────────────
let panel             = null;
let historyCache      = [];
let isAnalysisEnabled = false; // mirrors chrome.storage; default OFF
let isAnalyzing       = false; // guard against concurrent requests
let panelCreated      = false; // FIX: hard guard so we never create 2 panels

// FEATURE 1: track backend reachability to avoid flooding repeated error msgs
let lastBackendStatus = "unknown"; // "ok" | "error" | "unknown"
let lastAnalysisText  = null;      // for Retry button

// ─── Boot: read persisted settings from chrome.storage ───────────────────────
// FEATURE 6: read API_BASE and MAX_CHARS from options page settings
chrome.storage.sync.get(
  { apiBase: "http://127.0.0.1:8000", maxChars: 5000 },
  (settings) => {
    API_BASE  = settings.apiBase  || "http://127.0.0.1:8000";
    MAX_CHARS = settings.maxChars || 5000;
    console.log("[SSA] Boot — API_BASE:", API_BASE, "MAX_CHARS:", MAX_CHARS);
  }
);

chrome.storage.local.get(["analysisEnabled"], (res) => {
  isAnalysisEnabled = res.analysisEnabled === true;
  console.log("[SSA] Boot — analysis enabled:", isAnalysisEnabled);
  if (panel) syncToggleUI();
});

// ─── Utility: fetch with AbortController timeout (120 s) ─────────────────────
// BUG FIX: Renamed from fetchWithTimeout to fetchAPI.
// Real AbortController timeout — models can be slow but 120 s is a hard cap.
async function fetchAPI(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000); // 120 seconds
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return resp;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      // Throw a recognisable error so the caller can show a timeout message
      const timeoutErr = new Error("Request timed out after 120 seconds");
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    }
    throw err;
  }
}

// ─── XSS guard ───────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Panel factory ───────────────────────────────────────────────────────────
// FIX: strict singleton — if panel already exists in DOM, just return it.
function createPanel() {
  // FIX 1: Check both our flag AND the actual DOM to handle edge cases
  if (panelCreated && panel && document.getElementById("ssa-panel")) {
    return panel;
  }

  // FIX 2: If somehow a panel node exists in DOM but our variable is null, reuse it
  const existing = document.getElementById("ssa-panel");
  if (existing) {
    panel = existing;
    panelCreated = true;
    return panel;
  }

  panelCreated = true; // set before DOM work to block any re-entrant call

  panel = document.createElement("div");
  panel.id = "ssa-panel";
  panel.innerHTML = `
    <div id="ssa-header">
      <div id="ssa-header-left">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
        </svg>
        Study Assistant
      </div>
      <div id="ssa-header-right">
        <button id="ssa-toggle" title="Enable / Disable AI Analysis" aria-pressed="false">
          <span id="ssa-toggle-dot"></span>
          <span id="ssa-toggle-label">OFF</span>
        </button>
        <button id="ssa-minimize" title="Minimize">&#8212;</button>
        <button id="ssa-close"    title="Close">&#x2715;</button>
      </div>
    </div>

    <div id="ssa-status-bar">
      AI Analysis is <strong>OFF</strong>. Toggle above to enable. &nbsp;|&nbsp; Shortcut: Alt+S
    </div>

    <div id="ssa-body">
      <div id="ssa-tabs">
        <button class="ssa-tab ssa-tab-active" data-tab="simplified">Simplified</button>
        <button class="ssa-tab" data-tab="questions">Questions</button>
        <button class="ssa-tab" data-tab="keywords">Keywords</button>
        <button class="ssa-tab" data-tab="difficulty">Difficulty</button>
        <button class="ssa-tab" data-tab="history">History</button>
      </div>
      <div id="ssa-content">
        <div id="ssa-simplified" class="ssa-panel-section ssa-panel-active">
          <div class="ssa-empty">Enable AI Analysis above, then select any text (20+ chars) on the page.</div>
        </div>
        <div id="ssa-questions" class="ssa-panel-section">
          <div class="ssa-empty">Questions will appear here after analysis.</div>
        </div>
        <div id="ssa-keywords" class="ssa-panel-section">
          <div class="ssa-empty">Keywords will appear here after analysis.</div>
        </div>
        <div id="ssa-difficulty" class="ssa-panel-section">
          <div class="ssa-empty">Difficulty level will appear here after analysis.</div>
        </div>
        <div id="ssa-history" class="ssa-panel-section">
          <div class="ssa-empty">No history yet.</div>
        </div>
      </div>
      <div id="ssa-actions">
        <button id="ssa-back-btn" class="ssa-action-btn" style="display:none;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Back to History
        </button>
        <button id="ssa-export-pdf" class="ssa-action-btn" title="Export as PDF" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Export PDF
        </button>
        <!-- FEATURE 4: Markdown export — client-side only, no backend needed -->
        <button id="ssa-export-md" class="ssa-action-btn" title="Export as Markdown" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          Export MD
        </button>
      </div>
    </div>
  `;

  // ── Styles ──────────────────────────────────────────────────────────────────
  const style = document.createElement("style");
  style.id = "ssa-styles"; // ID so we never inject twice
  style.textContent = `
    #ssa-panel {
      position: fixed; top: 60px; right: 24px; width: 380px; max-height: 580px;
      background: #0f1729; border: 1px solid rgba(34,211,238,0.15); border-radius: 14px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.5), 0 0 20px rgba(34,211,238,0.08);
      z-index: 2147483647;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #e8edf5; overflow: hidden; display: flex; flex-direction: column;
      transition: box-shadow 0.2s; resize: both; min-width: 280px; min-height: 200px;
    }
    #ssa-panel.ssa-minimized #ssa-body,
    #ssa-panel.ssa-minimized #ssa-status-bar { display: none; }
    #ssa-panel.ssa-minimized { max-height: none; height: auto !important; resize: none; }
    #ssa-panel.ssa-dragging  { box-shadow: 0 12px 48px rgba(0,0,0,0.6), 0 0 30px rgba(34,211,238,0.15); cursor: grabbing; }

    #ssa-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px;
      background: linear-gradient(180deg, rgba(34,211,238,0.06) 0%, transparent 100%);
      border-bottom: 1px solid rgba(255,255,255,0.06);
      cursor: grab; user-select: none; flex-shrink: 0;
    }
    #ssa-header:active { cursor: grabbing; }
    #ssa-header-left {
      display: flex; align-items: center; gap: 8px;
      font-size: 13px; font-weight: 700; letter-spacing: -0.3px; color: #22d3ee;
    }
    #ssa-header-right { display: flex; align-items: center; gap: 6px; }

    #ssa-minimize, #ssa-close {
      width: 24px; height: 24px; border: none; background: rgba(255,255,255,0.05);
      color: #8b9bc0; border-radius: 6px; cursor: pointer; font-size: 12px;
      display: flex; align-items: center; justify-content: center; transition: all 0.15s;
    }
    #ssa-minimize:hover, #ssa-close:hover { background: rgba(255,255,255,0.1); color: #e8edf5; }

    /* ── Toggle button ── */
    #ssa-toggle {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 10px 4px 8px; border-radius: 20px;
      border: 1.5px solid #374151; background: #1e293b;
      cursor: pointer; font-size: 10px; font-weight: 700;
      font-family: inherit; letter-spacing: 0.5px;
      color: #64748b; transition: all 0.2s; user-select: none;
    }
    #ssa-toggle-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #374151; flex-shrink: 0; transition: background 0.2s;
    }
    #ssa-toggle.ssa-toggle-on {
      border-color: rgba(34,197,94,0.5); background: rgba(34,197,94,0.12); color: #22c55e;
    }
    #ssa-toggle.ssa-toggle-on #ssa-toggle-dot { background: #22c55e; }

    /* ── Status bar ── */
    #ssa-status-bar {
      font-size: 11px; color: #64748b;
      background: rgba(255,255,255,0.02);
      border-bottom: 1px solid rgba(255,255,255,0.05);
      padding: 5px 14px; text-align: center; flex-shrink: 0;
    }
    #ssa-status-bar.ssa-status-on {
      color: #22c55e; background: rgba(34,197,94,0.06);
      border-bottom-color: rgba(34,197,94,0.15);
    }

    #ssa-body { display: flex; flex-direction: column; flex: 1; overflow: hidden; }

    #ssa-tabs { display: flex; gap: 3px; padding: 10px 10px 0; flex-shrink: 0; flex-wrap: wrap; }
    .ssa-tab {
      padding: 6px 8px; font-size: 10.5px; font-weight: 500; color: #5a6a8a;
      background: transparent; border: 1px solid transparent; border-radius: 7px;
      cursor: pointer; transition: all 0.15s; font-family: inherit;
    }
    .ssa-tab:hover { color: #8b9bc0; background: #162039; }
    .ssa-tab-active { color: #22d3ee !important; background: rgba(34,211,238,0.12) !important; border-color: rgba(34,211,238,0.2) !important; }

    #ssa-content { padding: 10px 14px; flex: 1; overflow-y: auto; min-height: 80px; }
    #ssa-content::-webkit-scrollbar { width: 4px; }
    #ssa-content::-webkit-scrollbar-thumb { background: #5a6a8a; border-radius: 2px; }
    #ssa-content::-webkit-scrollbar-track { background: transparent; }

    .ssa-panel-section { display: none; }
    .ssa-panel-section.ssa-panel-active { display: block; }

    .ssa-empty { text-align: center; color: #5a6a8a; font-size: 12px; padding: 36px 10px; line-height: 1.7; }

    .ssa-text { font-size: 13px; line-height: 1.65; color: #e8edf5; background: #162039; border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 12px; }

    .ssa-q-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .ssa-q-item:last-child { border-bottom: none; }
    .ssa-q-num { flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%; background: rgba(34,211,238,0.15); color: #22d3ee; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
    .ssa-q-text { font-size: 12.5px; line-height: 1.5; color: #e8edf5; }

    .ssa-kw-grid { display: flex; flex-wrap: wrap; gap: 6px; }
    .ssa-kw-tag { padding: 4px 10px; font-size: 11px; font-weight: 500; font-family: monospace; color: #22d3ee; background: rgba(34,211,238,0.12); border: 1px solid rgba(34,211,238,0.2); border-radius: 20px; }

    .ssa-difficulty-badge { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 10px; font-size: 14px; font-weight: 600; }
    .ssa-difficulty-easy   { background: rgba(34,197,94,0.15); color: #22c55e; border: 1px solid rgba(34,197,94,0.3); }
    .ssa-difficulty-medium { background: rgba(234,179,8,0.15); color: #eab308; border: 1px solid rgba(234,179,8,0.3); }
    .ssa-difficulty-hard   { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }

    .ssa-error {
      font-size: 12px; line-height: 1.65; color: #fca5a5;
      background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2);
      border-radius: 10px; padding: 14px 12px;
    }
    .ssa-error strong { display: block; margin-bottom: 6px; font-size: 13px; color: #ef4444; }
    .ssa-error code { background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 4px; font-size: 11px; }
    /* FEATURE 1: Retry button inside error card */
    .ssa-retry-btn {
      margin-top: 10px; display: inline-flex; align-items: center; gap: 5px;
      padding: 5px 12px; font-size: 11px; font-weight: 600;
      color: #22d3ee; background: rgba(34,211,238,0.1);
      border: 1px solid rgba(34,211,238,0.25); border-radius: 6px;
      cursor: pointer; font-family: inherit; transition: all 0.15s;
    }
    .ssa-retry-btn:hover { background: rgba(34,211,238,0.2); }

    /* FEATURE 3: History search input */
    #ssa-history-search {
      width: 100%; box-sizing: border-box;
      padding: 6px 10px; margin-bottom: 10px;
      background: #162039; border: 1px solid rgba(255,255,255,0.08);
      border-radius: 7px; color: #e8edf5; font-size: 11px; font-family: inherit;
      outline: none; transition: border-color 0.15s;
    }
    #ssa-history-search:focus { border-color: rgba(34,211,238,0.35); }
    #ssa-history-search::placeholder { color: #5a6a8a; }

    .ssa-history-item { background: #162039; border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; transition: all 0.15s; }
    .ssa-history-item:hover { border-color: rgba(34,211,238,0.2); }
    .ssa-history-item-content { flex: 1; cursor: pointer; min-width: 0; }
    .ssa-history-text { font-size: 11px; color: #8b9bc0; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .ssa-history-meta { display: flex; gap: 8px; margin-top: 6px; }
    .ssa-history-tag { font-size: 9px; padding: 2px 6px; border-radius: 4px; background: rgba(34,211,238,0.1); color: #22d3ee; }
    .ssa-history-delete { flex-shrink: 0; width: 28px; height: 28px; border: none; background: rgba(239,68,68,0.1); color: #ef4444; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
    .ssa-history-delete:hover { background: rgba(239,68,68,0.25); color: #f87171; }

    #ssa-actions { padding: 8px 14px 12px; border-top: 1px solid rgba(255,255,255,0.06); flex-shrink: 0; display: flex; gap: 8px; flex-wrap: wrap; }
    .ssa-action-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; font-size: 11px; font-weight: 600; color: #22d3ee; background: rgba(34,211,238,0.1); border: 1px solid rgba(34,211,238,0.2); border-radius: 8px; cursor: pointer; transition: all 0.15s; font-family: inherit; }
    .ssa-action-btn:hover:not(:disabled) { background: rgba(34,211,238,0.2); }
    .ssa-action-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .ssa-loading { text-align: center; color: #22d3ee; font-size: 12px; padding: 30px 10px; }
    .ssa-loading::after {
      content: ''; display: inline-block; width: 14px; height: 14px;
      border: 2px solid rgba(34,211,238,0.25); border-top-color: #22d3ee;
      border-radius: 50%; animation: ssa-spin 0.7s linear infinite;
      margin-left: 8px; vertical-align: middle;
    }
    @keyframes ssa-spin { to { transform: rotate(360deg); } }

    /* BUG 6: truncation notice */
    #ssa-truncation-notice {
      font-size: 10px; color: #eab308; text-align: center;
      padding: 2px 14px; background: rgba(234,179,8,0.06);
      border-bottom: 1px solid rgba(234,179,8,0.15);
      flex-shrink: 0; display: none;
    }
  `;

  // FIX: Inject style only if not already present
  if (!document.getElementById("ssa-styles")) {
    document.head.appendChild(style);
  }

  // FIX: Append to body (not documentElement) — safer, less conflict with page CSS
  document.body.appendChild(panel);

  // Inject the truncation notice bar (BUG 6) just below the status bar
  const truncationNotice = document.createElement("div");
  truncationNotice.id = "ssa-truncation-notice";
  truncationNotice.textContent = "Text truncated to 5,000 chars";
  // Insert after status bar (which is the second child of the panel)
  const statusBar = panel.querySelector("#ssa-status-bar");
  statusBar.after(truncationNotice);

  // ── Drag logic ──────────────────────────────────────────────────────────────
  let isDragging = false, offsetX = 0, offsetY = 0;
  const header = panel.querySelector("#ssa-header");
  header.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;
    isDragging = true;
    const rect = panel.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    panel.classList.add("ssa-dragging");
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const x = Math.max(0, Math.min(window.innerWidth  - 100, e.clientX - offsetX));
    const y = Math.max(0, Math.min(window.innerHeight - 50,  e.clientY - offsetY));
    panel.style.left  = x + "px";
    panel.style.top   = y + "px";
    panel.style.right = "auto";
  });
  document.addEventListener("mouseup", () => {
    if (isDragging) { isDragging = false; panel.classList.remove("ssa-dragging"); }
  });

  // ── Tab switching ────────────────────────────────────────────────────────────
  panel.querySelectorAll(".ssa-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      panel.querySelectorAll(".ssa-tab").forEach((t) => t.classList.remove("ssa-tab-active"));
      panel.querySelectorAll(".ssa-panel-section").forEach((s) => s.classList.remove("ssa-panel-active"));
      tab.classList.add("ssa-tab-active");
      panel.querySelector(`#ssa-${tab.dataset.tab}`).classList.add("ssa-panel-active");
      panel.querySelector("#ssa-back-btn").style.display = "none";
    });
  });

  // ── History tab click ────────────────────────────────────────────────────────
  panel.querySelector('[data-tab="history"]').addEventListener("click", loadHistory);

  // ── Minimize / Close ─────────────────────────────────────────────────────────
  panel.querySelector("#ssa-minimize").addEventListener("click", () => panel.classList.toggle("ssa-minimized"));
  panel.querySelector("#ssa-close").addEventListener("click", () => {
    hidePanel();
    // Reset status bar to default when closed
    syncToggleUI();
  });

  // ── ON/OFF Toggle ─────────────────────────────────────────────────────────────
  panel.querySelector("#ssa-toggle").addEventListener("click", (e) => {
    e.stopPropagation();
    isAnalysisEnabled = !isAnalysisEnabled;
    chrome.storage.local.set({ analysisEnabled: isAnalysisEnabled });
    console.log("[SSA] Toggle →", isAnalysisEnabled ? "ON" : "OFF");
    syncToggleUI();
  });

  // ── Export PDF ───────────────────────────────────────────────────────────────
  panel.querySelector("#ssa-export-pdf").addEventListener("click", async () => {
    const stored = await new Promise((r) => chrome.storage.local.get(["analysis"], r));
    const analysis = stored.analysis;
    if (!analysis) { showInlineError("No analysis data to export yet."); return; }

    try {
      const resp = await fetchAPI(
        `${API_BASE}/export-pdf`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            simplified: analysis.simplified || "",
            questions:  analysis.questions  || [],
            keywords:   analysis.keywords   || [],
            difficulty: analysis.difficulty || ""
          })
        });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = "study_output.pdf"; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[SSA] PDF export error:", err);
      showInlineError("Could not export PDF — is the backend running?");
    }
  });

  // ── Export MD (FEATURE 4) ─────────────────────────────────────────────────────
  // Client-side only — builds Markdown from stored analysis and triggers download.
  panel.querySelector("#ssa-export-md").addEventListener("click", async () => {
    const stored = await new Promise((r) => chrome.storage.local.get(["analysis"], r));
    const analysis = stored.analysis;
    if (!analysis) { showInlineError("No analysis data to export yet."); return; }

    const questions = (analysis.questions || []).map((q, i) => `${i + 1}. ${q}`).join("\n");
    const keywords  = (analysis.keywords  || []).join(", ");
    const md = [
      "# Study Analysis",
      "",
      "## Simplified Text",
      analysis.simplified || "",
      "",
      "## Practice Questions",
      questions || "_No questions generated._",
      "",
      "## Keywords",
      keywords || "_No keywords found._",
      "",
      "## Difficulty",
      analysis.difficulty || "_Unknown_",
    ].join("\n");

    const blob = new Blob([md], { type: "text/markdown" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "study_analysis.md"; a.click();
    URL.revokeObjectURL(url);
  });

  // ── Back button ──────────────────────────────────────────────────────────────
  panel.querySelector("#ssa-back-btn").addEventListener("click", () => {
    panel.querySelector("#ssa-back-btn").style.display = "none";
    switchToTab("history");
    loadHistory();
  });

  syncToggleUI();
  return panel;
}

// ─── Toggle UI sync ──────────────────────────────────────────────────────────
function syncToggleUI(statusOverride = null) {
  if (!panel) return;
  const btn    = panel.querySelector("#ssa-toggle");
  const label  = panel.querySelector("#ssa-toggle-label");
  const status = panel.querySelector("#ssa-status-bar");

  // FEATURE 5: if a custom status string is provided (e.g. analysis summary),
  // show it instead of the default ON/OFF message.
  if (statusOverride !== null) {
    status.innerHTML = escapeHtml(statusOverride);
    status.classList.add("ssa-status-on");
    // Still keep the toggle button in sync visually
    if (isAnalysisEnabled) {
      btn.classList.add("ssa-toggle-on");
      btn.setAttribute("aria-pressed", "true");
      label.textContent = "ON";
    } else {
      btn.classList.remove("ssa-toggle-on");
      btn.setAttribute("aria-pressed", "false");
      label.textContent = "OFF";
    }
    return;
  }

  if (isAnalysisEnabled) {
    btn.classList.add("ssa-toggle-on");
    btn.setAttribute("aria-pressed", "true");
    label.textContent = "ON";
    status.innerHTML  = "AI Analysis is <strong>ON</strong> — select any text to analyze. &nbsp;|&nbsp; Alt+S to toggle";
    status.classList.add("ssa-status-on");
  } else {
    btn.classList.remove("ssa-toggle-on");
    btn.setAttribute("aria-pressed", "false");
    label.textContent = "OFF";
    status.innerHTML  = "AI Analysis is <strong>OFF</strong>. Toggle above to enable. &nbsp;|&nbsp; Alt+S to toggle";
    status.classList.remove("ssa-status-on");
  }
}

// ─── Tab helper ──────────────────────────────────────────────────────────────
function switchToTab(tabName) {
  if (!panel) return;
  panel.querySelectorAll(".ssa-tab").forEach((t) => t.classList.remove("ssa-tab-active"));
  panel.querySelectorAll(".ssa-panel-section").forEach((s) => s.classList.remove("ssa-panel-active"));
  const tab = panel.querySelector(`[data-tab="${tabName}"]`);
  if (tab) tab.classList.add("ssa-tab-active");
  const sec = panel.querySelector(`#ssa-${tabName}`);
  if (sec) sec.classList.add("ssa-panel-active");
}

// ─── Inline error (non-blocking, inside panel) ───────────────────────────────
function showInlineError(msg) {
  const p = createPanel();
  p.querySelector("#ssa-simplified").innerHTML =
    `<div class="ssa-error"><strong>Notice</strong>${escapeHtml(msg)}</div>`;
  switchToTab("simplified");
}

// ─── Loading state ───────────────────────────────────────────────────────────
function showLoading() {
  const p = createPanel();
  p.style.display = "flex";
  const msgs = {
    simplified: "Simplifying text…",
    questions:  "Generating questions…",
    keywords:   "Extracting keywords…",
    difficulty: "Detecting difficulty…"
  };
  Object.entries(msgs).forEach(([tab, msg]) => {
    p.querySelector(`#ssa-${tab}`).innerHTML = `<div class="ssa-loading">${msg}</div>`;
  });
  p.querySelector("#ssa-export-pdf").disabled = true;
  p.querySelector("#ssa-export-md").disabled  = true;
  p.querySelector("#ssa-back-btn").style.display = "none";
  switchToTab("simplified");
}

// ─── Error states — always escape infinite loading ───────────────────────────
// FEATURE 1: Shows "Retry" button inside error card.
// Error is only shown once per session (lastBackendStatus tracks this).
function showError(type) {
  const p = createPanel();
  const msgs = {
    network: {
      title: "Backend Offline",
      body:  "Cannot reach <code>127.0.0.1:8000</code>.<br>Run: <code>uvicorn main:app --reload --host 127.0.0.1 --port 8000</code>"
    },
    timeout: {
      title: "Request Timed Out",
      body:  "The model took longer than 120 seconds. The backend may be overloaded — try again shortly."
    },
    parse: {
      title: "Unexpected Response",
      body:  "Server returned unreadable data.<br>Check the backend console for Python errors."
    },
    unknown: {
      title: "Something Went Wrong",
      body:  "An unexpected error occurred. Open DevTools (F12) → Console for details."
    }
  };
  const { title, body } = msgs[type] || msgs.unknown;

  // FEATURE 1: Add "Retry" button if we have text to re-analyse
  const retryHtml = lastAnalysisText
    ? `<br><button class="ssa-retry-btn" id="ssa-retry-btn">↺ Retry</button>`
    : "";

  const html = `<div class="ssa-error"><strong>${title}</strong>${body}${retryHtml}</div>`;

  ["simplified", "questions", "keywords", "difficulty"].forEach((tab) => {
    p.querySelector(`#ssa-${tab}`).innerHTML = html;
  });
  p.querySelector("#ssa-export-pdf").disabled = true;
  p.querySelector("#ssa-export-md").disabled  = true;
  switchToTab("simplified");

  // Wire up the Retry button
  const retryBtn = p.querySelector("#ssa-retry-btn");
  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      if (lastAnalysisText) runAnalysis(lastAnalysisText);
    });
  }
}

// ─── Result renderer ─────────────────────────────────────────────────────────
function showResults(result) {
  const p = createPanel();

  p.querySelector("#ssa-simplified").innerHTML = result.simplified
    ? `<div class="ssa-text">${escapeHtml(result.simplified)}</div>`
    : `<div class="ssa-empty">No simplified text returned.</div>`;

  if (result.questions && result.questions.length) {
    p.querySelector("#ssa-questions").innerHTML = result.questions
      .map((q, i) => `<div class="ssa-q-item"><div class="ssa-q-num">${i + 1}</div><div class="ssa-q-text">${escapeHtml(q)}</div></div>`)
      .join("");
  } else {
    p.querySelector("#ssa-questions").innerHTML = `<div class="ssa-empty">No questions generated.</div>`;
  }

  if (result.keywords && result.keywords.length) {
    p.querySelector("#ssa-keywords").innerHTML =
      `<div class="ssa-kw-grid">${result.keywords.map(k => `<span class="ssa-kw-tag">${escapeHtml(k)}</span>`).join("")}</div>`;
  } else {
    p.querySelector("#ssa-keywords").innerHTML = `<div class="ssa-empty">No keywords found.</div>`;
  }

  if (result.difficulty) {
    const level = result.difficulty.toLowerCase();
    const icon  = level === "easy" ? "🟢" : level === "medium" ? "🟡" : "🔴";
    p.querySelector("#ssa-difficulty").innerHTML =
      `<div class="ssa-difficulty-badge ssa-difficulty-${level}">${icon} ${escapeHtml(result.difficulty)}</div>`;
  } else {
    p.querySelector("#ssa-difficulty").innerHTML = `<div class="ssa-empty">No difficulty data.</div>`;
  }

  p.querySelector("#ssa-export-pdf").disabled = false;
  p.querySelector("#ssa-export-md").disabled  = false;
  switchToTab("simplified");
}

// ─── History ─────────────────────────────────────────────────────────────────
async function loadHistory() {
  const p         = createPanel();
  const container = p.querySelector("#ssa-history");

  // FEATURE 3: inject search input at the top of the history section
  container.innerHTML = `
    <input type="text" id="ssa-history-search" placeholder="Search history…" autocomplete="off">
    <div id="ssa-history-list"><div class="ssa-loading">Loading history</div></div>
  `;

  // Wire up the search filter (client-side, no backend call)
  const searchInput = container.querySelector("#ssa-history-search");
  searchInput.addEventListener("input", () => {
    renderHistoryList(historyCache, searchInput.value);
  });

  try {
    const resp = await fetchAPI(`${API_BASE}/history`, {});
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const items = await resp.json();
    historyCache = items;
    renderHistoryList(items, "");

  } catch (err) {
    console.error("[SSA] loadHistory error:", err);
    container.querySelector("#ssa-history-list").innerHTML =
      '<div class="ssa-error"><strong>Backend Offline</strong>Start the server to view history.</div>';
  }
}

// FEATURE 3: render (filtered) history items into #ssa-history-list
function renderHistoryList(items, filterText) {
  const p    = createPanel();
  const list = p.querySelector("#ssa-history-list");
  if (!list) return;

  const query = filterText.trim().toLowerCase();
  const filtered = query
    ? items.filter(item => (item.input || item.text || "").toLowerCase().includes(query))
    : items;

  if (!filtered.length) {
    list.innerHTML = query
      ? '<div class="ssa-empty">No matches found.</div>'
      : '<div class="ssa-empty">No history yet.<br>Analyze some text to get started.</div>';
    return;
  }

  // BUG FIX (BUG 10): use data-id (UUID) instead of data-index
  list.innerHTML = filtered.map((item) => `
    <div class="ssa-history-item" data-id="${escapeHtml(item.id || "")}">
      <div class="ssa-history-item-content">
        <div class="ssa-history-text">${escapeHtml((item.input || item.text || "").slice(0, 120))}</div>
        <div class="ssa-history-meta">
          <span class="ssa-history-tag">${escapeHtml(item.difficulty || "?")}</span>
          <span class="ssa-history-tag">${(item.keywords || []).length} keywords</span>
        </div>
      </div>
      <button class="ssa-history-delete" data-delete-id="${escapeHtml(item.id || "")}" title="Delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          <line x1="10" y1="11" x2="10" y2="17"/>
          <line x1="14" y1="11" x2="14" y2="17"/>
        </svg>
      </button>
    </div>
  `).join("");

  list.querySelectorAll(".ssa-history-item-content").forEach((el) => {
    el.addEventListener("click", () => {
      const itemId = el.closest("[data-id]").dataset.id;
      const item   = historyCache.find(h => h.id === itemId);
      if (item) openHistoryDetail(item);
    });
  });

  // BUG FIX (BUG 10): pass the entry's UUID string, not its array position
  list.querySelectorAll(".ssa-history-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteHistoryItem(btn.dataset.deleteId);
    });
  });
}

// BUG FIX (BUG 10): takes a UUID string, not an integer index.
// EXTRA GUARD: skip the request if itemId is empty (old entries with no "id").
async function deleteHistoryItem(itemId) {
  if (!itemId || !itemId.trim()) {
    console.warn(
      "[SSA] deleteHistoryItem: empty itemId — entry has no UUID. Refreshing history."
    );

    loadHistory();
    return;
  }

  try {
    const resp = await fetchAPI(
      `${API_BASE}/history/${encodeURIComponent(itemId)}`,
      { method: "DELETE" }
    );

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    loadHistory();

  } catch (err) {
    console.error("[SSA] Delete error:", err);
    showInlineError("Could not delete — is the backend running?");
  }
}

function openHistoryDetail(item) {
  const p = createPanel();
  chrome.storage.local.set({ analysis: item, currentText: item.input || item.text || "" });
  showResults(item);
  p.querySelector("#ssa-back-btn").style.display = "inline-flex";
  p.querySelector("#ssa-export-pdf").disabled = false;
  p.querySelector("#ssa-export-md").disabled  = false;
}

// ─── Extension icon → toggle / show panel ────────────────────────────────────
let panelVisible = false;

function showPanel() {
  const p = createPanel();
  p.style.display = "flex";
  panelVisible = true;
  syncToggleUI();
}

function hidePanel() {
  if (!panel) return;
  panel.style.display = "none";
  panelVisible = false;
  // BUG 6: hide truncation notice when panel is closed
  const notice = panel.querySelector("#ssa-truncation-notice");
  if (notice) notice.style.display = "none";
  // FEATURE 5: reset status bar to default
  syncToggleUI();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "toggle-panel") {
    if (panelVisible) {
      hidePanel();
    } else {
      showPanel();
    }
  } else if (msg.action === "show-panel") {
    showPanel();
  }
});

// ─── Core analysis runner (extracted so Retry can call it) ────────────────────
async function runAnalysis(textToAnalyze) {
  isAnalyzing = true;
  lastAnalysisText = textToAnalyze; // store for Retry button
  showLoading();

  // Hide truncation notice at start; it will be shown if truncation occurred
  if (panel) {
    const notice = panel.querySelector("#ssa-truncation-notice");
    if (notice) notice.style.display = "none";
  }

  try {
    const resp = await fetchAPI(
      `${API_BASE}/analyze`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ text: textToAnalyze })
      }
    );

    console.log("[SSA] /analyze → HTTP", resp.status);
    lastBackendStatus = "ok"; // FEATURE 1

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      console.error("[SSA] Server error:", resp.status, errBody);
      showError("unknown");
      return;
    }

    let result;
    try {
      result = await resp.json();
    } catch (parseErr) {
      console.error("[SSA] JSON parse error:", parseErr);
      showError("parse");
      return;
    }

    console.log("[SSA] ✓ Result keys:", Object.keys(result).join(", "));
    chrome.storage.local.set({ analysis: result, currentText: textToAnalyze });
    showResults(result);

    // FEATURE 5: update status bar with compact analysis summary
    const charCount = textToAnalyze.length.toLocaleString();
    const kwCount   = (result.keywords || []).length;
    const diff      = result.difficulty || "?";
    syncToggleUI(`Analyzed ${charCount} chars · ${diff} · ${kwCount} keyword${kwCount !== 1 ? "s" : ""}`);

  } catch (err) {
    console.error("[SSA] Fetch error:", err.name, err.message);

    // FEATURE 1: only show the error card once per "offline session"
    if (err.isTimeout) {
      showError("timeout");
    } else if (lastBackendStatus !== "error") {
      lastBackendStatus = "error";
      showError("network");
    }
    // If backend was already known to be down, the panel already shows the error;
    // we don't overwrite it again on every subsequent mouseup.
  } finally {
    isAnalyzing = false;
    console.log("[SSA] ■ Request complete");
  }
}

// ─── Core: text selection → analysis ─────────────────────────────────────────
document.addEventListener("mouseup", async (e) => {
  if (e.target.closest && e.target.closest("#ssa-panel")) return;
  if (!isAnalysisEnabled) {
    console.log("[SSA] Skipped — analysis is OFF");
    return;
  }
  if (isAnalyzing) {
    console.log("[SSA] Skipped — request already in flight");
    return;
  }

  let selectedText = window.getSelection()?.toString() ?? "";

  selectedText = selectedText
    .replace(/AI Analysis is (ON|OFF)[^\n]*/gi, "")
    .replace(/Enable AI Analysis above[^\n]*/gi, "")
    .replace(/Smart Study Assistant[^\n]*/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (selectedText.length < 20) return;

  // BUG FIX (BUG 6): cap at MAX_CHARS and show a notice if truncated
  let truncated = false;
  if (selectedText.length > MAX_CHARS) {
    selectedText = selectedText.slice(0, MAX_CHARS);
    truncated = true;
  }

  // Show the truncation notice inside the panel status area
  if (truncated) {
    const p = createPanel();
    const notice = p.querySelector("#ssa-truncation-notice");
    if (notice) notice.style.display = "block";
  }

  console.log("[SSA] ▶ Analyzing %d chars: %s…", selectedText.length, selectedText.slice(0, 60));

  await runAnalysis(selectedText);
});

} // end double-injection guard
