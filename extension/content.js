// ===== Smart Study Assistant v3.0 — Fixed & Edge-Compatible =====
// Fixes: infinite loading, silent fetch failures, no toggle, race conditions
// New:   ON/OFF toggle (persisted), timeout guard, full error surfaces

"use strict";

// ─── Constants ───────────────────────────────────────────────────────────────
const API_BASE         = "http://127.0.0.1:8000";
const FETCH_TIMEOUT_MS = 30000; // 30 s — model inference can be slow

// ─── Module state ────────────────────────────────────────────────────────────
let panel             = null;
let historyCache      = [];
let isAnalysisEnabled = false; // mirrors chrome.storage; default OFF
let isAnalyzing       = false; // guard against concurrent requests

// ─── Boot: read persisted toggle state ───────────────────────────────────────
chrome.storage.local.get(["analysisEnabled"], (res) => {
  isAnalysisEnabled = res.analysisEnabled === true;
  console.log("[SSA] Boot — analysis enabled:", isAnalysisEnabled);
  if (panel) syncToggleUI();
});

// ─── Utility: fetch with AbortController timeout ─────────────────────────────
async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
    console.warn("[SSA] Fetch timed out:", url);
  }, timeoutMs);

  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return resp;
  } catch (err) {
    clearTimeout(timer);
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
function createPanel() {
  if (panel) return panel;

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

  // ── Styles ──────────────────────────────────────────────────────────────────
  const style = document.createElement("style");
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

  document.documentElement.appendChild(style);
  document.documentElement.appendChild(panel);

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
  panel.querySelector("#ssa-close").addEventListener("click",    () => { panel.style.display = "none"; });

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
      const resp = await fetchWithTimeout(
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
        },
        15000
      );
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
function syncToggleUI() {
  if (!panel) return;
  const btn    = panel.querySelector("#ssa-toggle");
  const label  = panel.querySelector("#ssa-toggle-label");
  const status = panel.querySelector("#ssa-status-bar");

  if (isAnalysisEnabled) {
    btn.classList.add("ssa-toggle-on");
    btn.setAttribute("aria-pressed", "true");
    label.textContent    = "ON";
    status.innerHTML     = "AI Analysis is <strong>ON</strong> — select any text to analyze.";
    status.classList.add("ssa-status-on");
  } else {
    btn.classList.remove("ssa-toggle-on");
    btn.setAttribute("aria-pressed", "false");
    label.textContent       = "OFF";
    status.innerHTML        = "AI Analysis is <strong>OFF</strong>. Toggle above to enable.";
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
  p.querySelector("#ssa-back-btn").style.display = "none";
  switchToTab("simplified");
}

// ─── Error states — always escape infinite loading ───────────────────────────
function showError(type) {
  const p = createPanel();
  const msgs = {
    network: {
      title: "Backend Offline",
      body:  "Cannot reach <code>127.0.0.1:8000</code>.<br>Run: <code>uvicorn main:app --reload --host 127.0.0.1 --port 8000</code>"
    },
    timeout: {
      title: "Request Timed Out",
      body:  "The model took too long (30 s limit).<br>Try a shorter text selection."
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
  const html = `<div class="ssa-error"><strong>${title}</strong>${body}</div>`;

  // Write into ALL tab sections — no tab will be left showing a spinner
  ["simplified", "questions", "keywords", "difficulty"].forEach((tab) => {
    p.querySelector(`#ssa-${tab}`).innerHTML = html;
  });
  p.querySelector("#ssa-export-pdf").disabled = true;
  switchToTab("simplified");
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
  switchToTab("simplified");
}

// ─── History ─────────────────────────────────────────────────────────────────
async function loadHistory() {
  const p         = createPanel();
  const container = p.querySelector("#ssa-history");
  container.innerHTML = '<div class="ssa-loading">Loading history</div>';

  try {
    const resp = await fetchWithTimeout(`${API_BASE}/history`, {}, 10000);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const items = await resp.json();
    historyCache = items;

    if (!items.length) {
      container.innerHTML = '<div class="ssa-empty">No history yet.<br>Analyze some text to get started.</div>';
      return;
    }

    container.innerHTML = items.map((item, i) => `
      <div class="ssa-history-item" data-index="${i}">
        <div class="ssa-history-item-content">
          <div class="ssa-history-text">${escapeHtml((item.input || item.text || "").slice(0, 120))}</div>
          <div class="ssa-history-meta">
            <span class="ssa-history-tag">${escapeHtml(item.difficulty || "?")}</span>
            <span class="ssa-history-tag">${(item.keywords || []).length} keywords</span>
          </div>
        </div>
        <button class="ssa-history-delete" data-delete-index="${i}" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            <line x1="10" y1="11" x2="10" y2="17"/>
            <line x1="14" y1="11" x2="14" y2="17"/>
          </svg>
        </button>
      </div>
    `).join("");

    container.querySelectorAll(".ssa-history-item-content").forEach((el) => {
      el.addEventListener("click", () => {
        const idx = parseInt(el.closest("[data-index]").dataset.index, 10);
        openHistoryDetail(historyCache[idx]);
      });
    });
    container.querySelectorAll(".ssa-history-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteHistoryItem(parseInt(btn.dataset.deleteIndex, 10));
      });
    });

  } catch (err) {
    console.error("[SSA] loadHistory error:", err);
    container.innerHTML =
      '<div class="ssa-error"><strong>Backend Offline</strong>Start the server to view history.</div>';
  }
}

async function deleteHistoryItem(index) {
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/history/${index}`, { method: "DELETE" }, 8000);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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
}

// ─── Extension icon → toggle panel visibility ────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "toggle-panel") {
    const p = createPanel();
    const hidden = !p.style.display || p.style.display === "none";
    p.style.display = hidden ? "flex" : "none";
    if (hidden) syncToggleUI();
  }
});

// ─── Core: text selection → analysis ─────────────────────────────────────────
document.addEventListener("mouseup", async (e) => {
  // 1. Ignore clicks inside the panel
  if (e.target.closest && e.target.closest("#ssa-panel")) return;

  // 2. Check the toggle — bail silently when OFF
  if (!isAnalysisEnabled) {
    console.log("[SSA] Skipped — analysis is OFF");
    return;
  }

  // 3. Prevent concurrent requests
  if (isAnalyzing) {
    console.log("[SSA] Skipped — request already in flight");
    return;
  }

  const selectedText = window.getSelection()?.toString().trim() ?? "";

  // 4. Minimum length
  if (selectedText.length < 20) return;

  console.log("[SSA] ▶ Analyzing %d chars: %s…", selectedText.length, selectedText.slice(0, 60));

  isAnalyzing = true;
  showLoading();

  try {
    const resp = await fetchWithTimeout(
      `${API_BASE}/analyze`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ text: selectedText })
      }
    );

    console.log("[SSA] /analyze → HTTP", resp.status);

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
    chrome.storage.local.set({ analysis: result, currentText: selectedText });
    showResults(result);

  } catch (err) {
    if (err.name === "AbortError") {
      console.error("[SSA] Aborted — timeout after", FETCH_TIMEOUT_MS, "ms");
      showError("timeout");
    } else {
      console.error("[SSA] Fetch error:", err.name, err.message);
      showError("network");
    }
  } finally {
    isAnalyzing = false;
    console.log("[SSA] ■ Request complete");
  }
});
