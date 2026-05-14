/**
 * pdf_viewer.js  (FIXED)
 *
 * Renders PDF pages with PDF.js + selectable text layer AND runs the full
 * Smart Study Assistant panel inline.
 *
 * Why inline: Chrome does not inject content scripts into chrome-extension://
 * pages. Since pdf_viewer.html is served from the extension origin, content.js
 * never loads here. We embed the entire panel + analysis logic directly so
 * text selection → analysis works identically to normal web pages.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * BUG FIXES IN THIS FILE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * BUG 1 — renderTextLayer API mismatch (PRIMARY CAUSE of broken text selection)
 * ─────────────────────────────────────────────────────────────────────────────
 * await renderTextLayer(...).promise so spans are in the DOM before any mouseup.
 *
 * BUG 2 — Panel not visible on load
 * ─────────────────────────────────────────────────────────────────────────────
 * showPanel() called at boot so panel auto-shows on the PDF viewer page.
 *
 * BUG 3 — selectionchange fallback not reset between pages
 * ─────────────────────────────────────────────────────────────────────────────
 * mousedown handler properly clears _lastSelection.
 *
 * BUG 4 — renderPage not awaited during rerender / zoom
 * ─────────────────────────────────────────────────────────────────────────────
 * renderPage now fully awaits both canvas render AND text layer render.
 *
 * BUG 10 — History delete used numeric array index instead of UUID
 * ─────────────────────────────────────────────────────────────────────────────
 * loadHistory() now renders data-delete-id="${item.id}" (UUID string).
 * deleteHistoryItem() sends DELETE /history/<uuid> not DELETE /history/<number>.
 * This was causing 307 redirect → 405 Method Not Allowed because:
 *   - Numeric index "0" was sent to /history/0  (no such route)
 *   - FastAPI redirected /history/ to /history  (307)
 *   - /history has no DELETE handler → 405
 */

"use strict";

// ── PDF.js worker ─────────────────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.js");

// ── Shared constants ──────────────────────────────────────────────────────────
const API_BASE = "https://smart-study-assistant-9u6m.onrender.com";

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — PANEL (mirrors content.js panel logic)
// ─────────────────────────────────────────────────────────────────────────────

let panel             = null;
let historyCache      = [];
let isAnalysisEnabled = false;
let isAnalyzing       = false;
let panelCreated      = false;
let panelVisible      = false;

// Restore toggle state from storage
chrome.storage.local.get(["analysisEnabled"], (res) => {
  isAnalysisEnabled = res.analysisEnabled === true;
  if (panel) syncToggleUI();
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createPanel() {
  if (panelCreated && panel && document.getElementById("ssa-panel")) return panel;
  const existing = document.getElementById("ssa-panel");
  if (existing) { panel = existing; panelCreated = true; return panel; }

  panelCreated = true;
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
      AI Analysis is <strong>OFF</strong>. Toggle above to enable.
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
      </div>
    </div>
  `;

  // ── Styles ────────────────────────────────────────────────────────────────
  if (!document.getElementById("ssa-styles")) {
    const style = document.createElement("style");
    style.id = "ssa-styles";
    style.textContent = `
      #ssa-panel {
        position: fixed; top: 70px; right: 24px; width: 380px; max-height: 580px;
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
      #ssa-toggle.ssa-toggle-on { border-color: rgba(34,197,94,0.5); background: rgba(34,197,94,0.12); color: #22c55e; }
      #ssa-toggle.ssa-toggle-on #ssa-toggle-dot { background: #22c55e; }
      #ssa-status-bar {
        font-size: 11px; color: #64748b;
        background: rgba(255,255,255,0.02);
        border-bottom: 1px solid rgba(255,255,255,0.05);
        padding: 5px 14px; text-align: center; flex-shrink: 0;
      }
      #ssa-status-bar.ssa-status-on { color: #22c55e; background: rgba(34,197,94,0.06); border-bottom-color: rgba(34,197,94,0.15); }
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
      .ssa-difficulty-easy   { background: rgba(34,197,94,0.15);  color: #22c55e; border: 1px solid rgba(34,197,94,0.3); }
      .ssa-difficulty-medium { background: rgba(234,179,8,0.15);  color: #eab308; border: 1px solid rgba(234,179,8,0.3); }
      .ssa-difficulty-hard   { background: rgba(239,68,68,0.15);  color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }
      .ssa-error { font-size: 12px; line-height: 1.65; color: #fca5a5; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); border-radius: 10px; padding: 14px 12px; }
      .ssa-error strong { display: block; margin-bottom: 6px; font-size: 13px; color: #ef4444; }
      .ssa-error code { background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 4px; font-size: 11px; }
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
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(panel);

  // ── Drag ──────────────────────────────────────────────────────────────────
  let isDragging = false, offsetX = 0, offsetY = 0;
  const hdr = panel.querySelector("#ssa-header");
  hdr.addEventListener("mousedown", (e) => {
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
    panel.style.left  = Math.max(0, Math.min(window.innerWidth  - 100, e.clientX - offsetX)) + "px";
    panel.style.top   = Math.max(0, Math.min(window.innerHeight - 50,  e.clientY - offsetY)) + "px";
    panel.style.right = "auto";
  });
  document.addEventListener("mouseup", () => {
    if (isDragging) { isDragging = false; panel.classList.remove("ssa-dragging"); }
  });

  // ── Tabs ──────────────────────────────────────────────────────────────────
  panel.querySelectorAll(".ssa-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      panel.querySelectorAll(".ssa-tab").forEach((t) => t.classList.remove("ssa-tab-active"));
      panel.querySelectorAll(".ssa-panel-section").forEach((s) => s.classList.remove("ssa-panel-active"));
      tab.classList.add("ssa-tab-active");
      panel.querySelector(`#ssa-${tab.dataset.tab}`).classList.add("ssa-panel-active");
      panel.querySelector("#ssa-back-btn").style.display = "none";
    });
  });

  panel.querySelector('[data-tab="history"]').addEventListener("click", loadHistory);
  panel.querySelector("#ssa-minimize").addEventListener("click", () => panel.classList.toggle("ssa-minimized"));
  panel.querySelector("#ssa-close").addEventListener("click", () => hidePanel());

  panel.querySelector("#ssa-toggle").addEventListener("click", (e) => {
    e.stopPropagation();
    isAnalysisEnabled = !isAnalysisEnabled;
    chrome.storage.local.set({ analysisEnabled: isAnalysisEnabled });
    syncToggleUI();
  });

  panel.querySelector("#ssa-export-pdf").addEventListener("click", async () => {
    const stored   = await new Promise((r) => chrome.storage.local.get(["analysis"], r));
    const analysis = stored.analysis;
    if (!analysis) { showInlineError("No analysis data to export yet."); return; }
    try {
      const resp = await fetch(`${API_BASE}/export-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          simplified: analysis.simplified || "",
          questions:  analysis.questions  || [],
          keywords:   analysis.keywords   || [],
          difficulty: analysis.difficulty || "",
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = "study_output.pdf"; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showInlineError("Could not export PDF — is the backend running?");
    }
  });

  panel.querySelector("#ssa-back-btn").addEventListener("click", () => {
    panel.querySelector("#ssa-back-btn").style.display = "none";
    switchToTab("history");
    loadHistory();
  });

  syncToggleUI();
  return panel;
}

function syncToggleUI() {
  if (!panel) return;
  const btn    = panel.querySelector("#ssa-toggle");
  const label  = panel.querySelector("#ssa-toggle-label");
  const status = panel.querySelector("#ssa-status-bar");
  if (isAnalysisEnabled) {
    btn.classList.add("ssa-toggle-on");
    btn.setAttribute("aria-pressed", "true");
    label.textContent = "ON";
    status.innerHTML  = "AI Analysis is <strong>ON</strong> — select any text to analyze.";
    status.classList.add("ssa-status-on");
  } else {
    btn.classList.remove("ssa-toggle-on");
    btn.setAttribute("aria-pressed", "false");
    label.textContent = "OFF";
    status.innerHTML  = "AI Analysis is <strong>OFF</strong>. Toggle above to enable.";
    status.classList.remove("ssa-status-on");
  }
}

function switchToTab(tabName) {
  if (!panel) return;
  panel.querySelectorAll(".ssa-tab").forEach((t) => t.classList.remove("ssa-tab-active"));
  panel.querySelectorAll(".ssa-panel-section").forEach((s) => s.classList.remove("ssa-panel-active"));
  const tab = panel.querySelector(`[data-tab="${tabName}"]`);
  if (tab) tab.classList.add("ssa-tab-active");
  const sec = panel.querySelector(`#ssa-${tabName}`);
  if (sec) sec.classList.add("ssa-panel-active");
}

function showInlineError(msg) {
  createPanel();
  panel.querySelector("#ssa-simplified").innerHTML =
    `<div class="ssa-error"><strong>Notice</strong>${escapeHtml(msg)}</div>`;
  switchToTab("simplified");
}

function showLoading() {
  const p = createPanel();
  p.style.display = "flex";
  const msgs = {
    simplified: "Simplifying text…",
    questions:  "Generating questions…",
    keywords:   "Extracting keywords…",
    difficulty: "Detecting difficulty…",
  };
  Object.entries(msgs).forEach(([tab, msg]) => {
    p.querySelector(`#ssa-${tab}`).innerHTML = `<div class="ssa-loading">${msg}</div>`;
  });
  p.querySelector("#ssa-export-pdf").disabled = true;
  p.querySelector("#ssa-back-btn").style.display = "none";
  switchToTab("simplified");
}

function showError(type) {
  const p = createPanel();
  const msgs = {
    network: { title: "Backend Offline", body: "Cannot reach the backend. Check your API URL in the extension Options page." },
    parse:   { title: "Unexpected Response", body: "Server returned unreadable data." },
    unknown: { title: "Something Went Wrong", body: "An unexpected error occurred." },
  };
  const { title, body } = msgs[type] || msgs.unknown;
  const html = `<div class="ssa-error"><strong>${title}</strong>${body}</div>`;
  ["simplified", "questions", "keywords", "difficulty"].forEach((tab) => {
    p.querySelector(`#ssa-${tab}`).innerHTML = html;
  });
  p.querySelector("#ssa-export-pdf").disabled = true;
  switchToTab("simplified");
}

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
      `<div class="ssa-kw-grid">${result.keywords.map((k) => `<span class="ssa-kw-tag">${escapeHtml(k)}</span>`).join("")}</div>`;
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
  switchToTab("simplified");
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY — BUG 10 FIX
//
// BEFORE (broken):
//   - Rendered data-delete-index="${i}" (numeric position in array)
//   - Delete called: fetch(`${API_BASE}/history/${idx}`, { method: "DELETE" })
//     where idx = 0, 1, 2 … — no such route exists
//   - FastAPI has DELETE /history/{id} expecting a UUID string
//   - Result: 307 redirect → /history → 405 Method Not Allowed
//
// AFTER (fixed):
//   - Renders data-delete-id="${item.id}" (UUID string from backend)
//   - Delete calls: fetch(`${API_BASE}/history/${encodeURIComponent(itemId)}`)
//     where itemId is the UUID — matches the FastAPI route exactly
// ─────────────────────────────────────────────────────────────────────────────

async function loadHistory() {
  const p         = createPanel();
  const container = p.querySelector("#ssa-history");
  container.innerHTML = '<div class="ssa-loading">Loading history</div>';
  try {
    const resp  = await fetch(`${API_BASE}/history`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const items = await resp.json();
    historyCache = items;
    if (!items.length) {
      container.innerHTML = '<div class="ssa-empty">No history yet.</div>';
      return;
    }

    // BUG 10 FIX: use item.id (UUID) in both data-id and data-delete-id
    container.innerHTML = items.map((item) => `
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
          </svg>
        </button>
      </div>
    `).join("");

    // Click on item content → show full analysis
    container.querySelectorAll(".ssa-history-item-content").forEach((el) => {
      el.addEventListener("click", () => {
        const itemId = el.closest("[data-id]").dataset.id;
        const item   = historyCache.find((h) => h.id === itemId);
        if (!item) return;
        chrome.storage.local.set({ analysis: item });
        showResults(item);
        panel.querySelector("#ssa-back-btn").style.display = "inline-flex";
        panel.querySelector("#ssa-export-pdf").disabled = false;
      });
    });

    // BUG 10 FIX: read UUID from data-delete-id, not a numeric index
    container.querySelectorAll(".ssa-history-delete").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const itemId = btn.dataset.deleteId;   // UUID string
        await deleteHistoryItem(itemId);
      });
    });

  } catch (err) {
    console.error("[SSA PDF] loadHistory error:", err);
    container.innerHTML = '<div class="ssa-error"><strong>Backend Offline</strong>Start the server to view history.</div>';
  }
}

// BUG 10 FIX: DELETE /history/<uuid> — previously sent DELETE /history/<number>
//
// EXTRA GUARD: if itemId is empty (happens when old history entries pre-date
// the UUID fix and have no "id" field), skip the request entirely.
// An empty itemId would produce the URL /history/ (trailing slash) which
// previously caused: 307 Temporary Redirect → DELETE /history → 405.
async function deleteHistoryItem(itemId) {
  if (!itemId || !itemId.trim()) {
    console.warn("[SSA PDF] deleteHistoryItem: empty itemId — entry has no UUID. Refreshing history.");
    loadHistory();
    return;
  }
  try {
    const resp = await fetch(
      `${API_BASE}/history/${encodeURIComponent(itemId)}`,
      { method: "DELETE" }
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    loadHistory();   // refresh list
  } catch (err) {
    console.error("[SSA PDF] Delete error:", err);
    showInlineError("Could not delete — is the backend running?");
  }
}

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
}

// Extension icon message
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "toggle-panel") {
    panelVisible ? hidePanel() : showPanel();
  } else if (msg.action === "show-panel") {
    showPanel();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — TEXT SELECTION → ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

let _lastSelection = "";

// Clear stale selection on every new mouse press
document.addEventListener("mousedown", (e) => {
  if (e.target.closest && e.target.closest("#ssa-panel")) return;
  _lastSelection = "";
});

// Track selection continuously while user drags across text layer spans.
document.addEventListener("selectionchange", () => {
  const sel = window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "";
  if (sel.length >= 20) _lastSelection = sel;
});

document.addEventListener("mouseup", async (e) => {
  if (e.target.closest && e.target.closest("#ssa-panel")) return;
  if (!isAnalysisEnabled) return;
  if (isAnalyzing) return;

  // Short settle delay so browser can finalize the selection after PDF.js
  // text layer focus events settle. 120ms is enough for all tested cases.
  await new Promise((r) => setTimeout(r, 120));

  // Live selection is preferred; fall back to last captured if it was cleared
  let selectedText = window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "";
  if (selectedText.length < 20) selectedText = _lastSelection;
  if (selectedText.length < 20) return;

  console.log("[SSA PDF] Analyzing:", selectedText.slice(0, 60));
  isAnalyzing = true;
  showLoading();

  try {
    const resp = await fetch(`${API_BASE}/analyze`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ text: selectedText }),
    });

    if (!resp.ok) { showError("unknown"); return; }

    let result;
    try { result = await resp.json(); }
    catch { showError("parse"); return; }

    chrome.storage.local.set({ analysis: result, currentText: selectedText });
    showResults(result);

  } catch {
    showError("network");
  } finally {
    isAnalyzing = false;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — PDF RENDERING
// ─────────────────────────────────────────────────────────────────────────────

let pdfDoc      = null;
let currentPage = 1;
let scale       = 1.4;
const pdfContainer = document.getElementById("ssa-pdf-container");

const params = new URLSearchParams(window.location.search);
const pdfUrl = params.get("file");

if (!pdfUrl) {
  showPdfError("No PDF URL provided.");
} else {
  document.getElementById("ssa-filename").textContent =
    decodeURIComponent(pdfUrl.split("/").pop().split("?")[0]);
  loadPDF(pdfUrl);
}

// BUG 2 FIX: Auto-show panel on load.
showPanel();

async function loadPDF(url) {
  try {
    pdfDoc = await pdfjsLib.getDocument(url).promise;
    const total = pdfDoc.numPages;
    document.getElementById("ssa-page-count").textContent = `of ${total}`;
    document.getElementById("ssa-page-input").max = total;
    document.getElementById("ssa-next").disabled = total <= 1;
    document.getElementById("ssa-loading")?.remove();

    // Render all pages sequentially (each awaited so text layers are ready)
    for (let i = 1; i <= total; i++) await renderPage(i);

  } catch (err) {
    showPdfError(
      `Could not load PDF.\n\n${err.message}\n\nFor local files, enable "Allow access to file URLs" in chrome://extensions.`
    );
  }
}

async function renderPage(pageNum) {
  const page     = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const dpr  = window.devicePixelRatio || 1;
  const cssW = Math.floor(viewport.width);
  const cssH = Math.floor(viewport.height);

  const wrapper = document.createElement("div");
  wrapper.className    = "ssa-pdf-page";
  wrapper.id           = `ssa-page-${pageNum}`;
  wrapper.style.width  = `${cssW}px`;
  wrapper.style.height = `${cssH}px`;

  const canvas = document.createElement("canvas");
  const ctx    = canvas.getContext("2d");
  canvas.width        = Math.floor(cssW * dpr);
  canvas.height       = Math.floor(cssH * dpr);
  canvas.style.width  = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  wrapper.appendChild(canvas);

  const textLayerDiv = document.createElement("div");
  textLayerDiv.className = "textLayer";
  textLayerDiv.style.setProperty("--scale-factor", viewport.scale);
  textLayerDiv.style.width  = `${cssW}px`;
  textLayerDiv.style.height = `${cssH}px`;
  wrapper.appendChild(textLayerDiv);
  pdfContainer.appendChild(wrapper);

  ctx.scale(dpr, dpr);
  await page.render({ canvasContext: ctx, viewport }).promise;

  // BUG 1 FIX: await text layer so spans are in DOM before any mouseup
  const textContent = await page.getTextContent();
  await pdfjsLib.renderTextLayer({
    textContentSource: textContent,
    container:         textLayerDiv,
    viewport,
    textDivs:          [],
  }).promise;
}

// Toolbar controls
document.getElementById("ssa-prev").addEventListener("click", () => {
  if (currentPage <= 1) return;
  currentPage--;
  document.getElementById(`ssa-page-${currentPage}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  syncNav();
});

document.getElementById("ssa-next").addEventListener("click", () => {
  if (!pdfDoc || currentPage >= pdfDoc.numPages) return;
  currentPage++;
  document.getElementById(`ssa-page-${currentPage}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  syncNav();
});

document.getElementById("ssa-page-input").addEventListener("change", (e) => {
  const n = parseInt(e.target.value, 10);
  if (!pdfDoc || isNaN(n) || n < 1 || n > pdfDoc.numPages) return;
  currentPage = n;
  document.getElementById(`ssa-page-${currentPage}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  syncNav();
});

document.getElementById("ssa-zoom-in").addEventListener("click",  () => rerender(scale + 0.2));
document.getElementById("ssa-zoom-out").addEventListener("click", () => rerender(Math.max(0.5, scale - 0.2)));

function syncNav() {
  document.getElementById("ssa-page-input").value = currentPage;
  if (pdfDoc) {
    document.getElementById("ssa-prev").disabled = currentPage <= 1;
    document.getElementById("ssa-next").disabled = currentPage >= pdfDoc.numPages;
  }
}

async function rerender(newScale) {
  scale = newScale;
  pdfContainer.innerHTML = "";
  if (!pdfDoc) return;
  // BUG 4 FIX: properly await each page including its text layer
  for (let i = 1; i <= pdfDoc.numPages; i++) await renderPage(i);
}

// Track current page via IntersectionObserver as user scrolls
new MutationObserver(() => {
  document.querySelectorAll(".ssa-pdf-page").forEach((el) => {
    new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const n = parseInt(entry.target.id.split("-").pop(), 10);
          if (!isNaN(n)) { currentPage = n; syncNav(); }
        }
      }
    }, { threshold: 0.5 }).observe(el);
  });
}).observe(pdfContainer, { childList: true });

function showPdfError(msg) {
  document.getElementById("ssa-loading")?.remove();
  const div = document.createElement("div");
  div.style.cssText = "margin-top:40px;text-align:center;color:#ef4444;font-size:13px;padding:0 40px;line-height:1.8;white-space:pre-line;";
  div.textContent = msg;
  pdfContainer.appendChild(div);
}
</file>

<file path="extension/pdf.js">