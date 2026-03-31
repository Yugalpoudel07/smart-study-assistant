// ===== Smart Study Assistant v2.1 — In-Page Draggable Panel =====

let panel = null;
let historyCache = [];

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
        <button id="ssa-minimize" title="Minimize">─</button>
        <button id="ssa-close" title="Close">✕</button>
      </div>
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
          <div class="ssa-empty">Select text (20+ chars) to analyze...</div>
        </div>
        <div id="ssa-questions" class="ssa-panel-section">
          <div class="ssa-empty">Questions will appear here</div>
        </div>
        <div id="ssa-keywords" class="ssa-panel-section">
          <div class="ssa-empty">Keywords will appear here</div>
        </div>
        <div id="ssa-difficulty" class="ssa-panel-section">
          <div class="ssa-empty">Difficulty level will appear here</div>
        </div>
        <div id="ssa-history" class="ssa-panel-section">
          <div class="ssa-empty">Analysis history will appear here</div>
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

  const style = document.createElement("style");
  style.textContent = `
    #ssa-panel {
      position: fixed;
      top: 60px;
      right: 24px;
      width: 380px;
      max-height: 560px;
      background: #0f1729;
      border: 1px solid rgba(34,211,238,0.15);
      border-radius: 14px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.5), 0 0 20px rgba(34,211,238,0.08);
      z-index: 2147483647;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      color: #e8edf5;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transition: box-shadow 0.2s;
      resize: both;
      min-width: 280px;
      min-height: 200px;
    }
    #ssa-panel.ssa-minimized #ssa-body { display: none; }
    #ssa-panel.ssa-minimized { max-height: none; height: auto !important; resize: none; }
    #ssa-panel.ssa-dragging { box-shadow: 0 12px 48px rgba(0,0,0,0.6), 0 0 30px rgba(34,211,238,0.15); cursor: grabbing; }

    #ssa-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px;
      background: linear-gradient(180deg, rgba(34,211,238,0.06) 0%, transparent 100%);
      border-bottom: 1px solid rgba(255,255,255,0.06);
      cursor: grab; user-select: none; flex-shrink: 0;
    }
    #ssa-header:active { cursor: grabbing; }
    #ssa-header-left { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; letter-spacing: -0.3px; color: #22d3ee; }
    #ssa-header-left svg { color: #22d3ee; }
    #ssa-header-right { display: flex; gap: 4px; }
    #ssa-header-right button {
      width: 24px; height: 24px; border: none; background: rgba(255,255,255,0.05);
      color: #8b9bc0; border-radius: 6px; cursor: pointer; font-size: 12px;
      display: flex; align-items: center; justify-content: center; transition: all 0.15s;
    }
    #ssa-header-right button:hover { background: rgba(255,255,255,0.1); color: #e8edf5; }

    #ssa-body { display: flex; flex-direction: column; flex: 1; overflow: hidden; }

    #ssa-tabs { display: flex; gap: 3px; padding: 10px 10px 0; flex-shrink: 0; flex-wrap: wrap; }
    .ssa-tab {
      padding: 6px 8px; font-size: 10.5px; font-weight: 500; color: #5a6a8a;
      background: transparent; border: 1px solid transparent; border-radius: 7px;
      cursor: pointer; transition: all 0.15s; font-family: inherit;
    }
    .ssa-tab:hover { color: #8b9bc0; background: #162039; }
    .ssa-tab-active { color: #22d3ee !important; background: rgba(34,211,238,0.12) !important; border-color: rgba(34,211,238,0.2) !important; }

    #ssa-content { padding: 10px 14px; flex: 1; overflow-y: auto; }
    #ssa-content::-webkit-scrollbar { width: 4px; }
    #ssa-content::-webkit-scrollbar-thumb { background: #5a6a8a; border-radius: 2px; }
    #ssa-content::-webkit-scrollbar-track { background: transparent; }

    .ssa-panel-section { display: none; }
    .ssa-panel-section.ssa-panel-active { display: block; }

    .ssa-empty { text-align: center; color: #5a6a8a; font-size: 12px; padding: 40px 10px; }

    .ssa-text { font-size: 13px; line-height: 1.65; color: #e8edf5; background: #162039; border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 12px; }

    .ssa-q-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .ssa-q-item:last-child { border-bottom: none; }
    .ssa-q-num { flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%; background: rgba(34,211,238,0.15); color: #22d3ee; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
    .ssa-q-text { font-size: 12.5px; line-height: 1.5; color: #e8edf5; }

    .ssa-kw-grid { display: flex; flex-wrap: wrap; gap: 6px; }
    .ssa-kw-tag { padding: 4px 10px; font-size: 11px; font-weight: 500; font-family: 'JetBrains Mono', monospace; color: #22d3ee; background: rgba(34,211,238,0.12); border: 1px solid rgba(34,211,238,0.2); border-radius: 20px; }

    .ssa-difficulty-badge {
      display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px;
      border-radius: 10px; font-size: 14px; font-weight: 600;
    }
    .ssa-difficulty-easy { background: rgba(34,197,94,0.15); color: #22c55e; border: 1px solid rgba(34,197,94,0.3); }
    .ssa-difficulty-medium { background: rgba(234,179,8,0.15); color: #eab308; border: 1px solid rgba(234,179,8,0.3); }
    .ssa-difficulty-hard { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }

    .ssa-history-item {
      background: #162039; border: 1px solid rgba(255,255,255,0.06); border-radius: 10px;
      padding: 10px 12px; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; transition: all 0.15s;
    }
    .ssa-history-item:hover { border-color: rgba(34,211,238,0.2); }
    .ssa-history-item-content { flex: 1; cursor: pointer; min-width: 0; }
    .ssa-history-text { font-size: 11px; color: #8b9bc0; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .ssa-history-meta { display: flex; gap: 8px; margin-top: 6px; }
    .ssa-history-tag { font-size: 9px; padding: 2px 6px; border-radius: 4px; background: rgba(34,211,238,0.1); color: #22d3ee; }

    .ssa-history-delete {
      flex-shrink: 0; width: 28px; height: 28px; border: none;
      background: rgba(239,68,68,0.1); color: #ef4444; border-radius: 6px;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: all 0.15s;
    }
    .ssa-history-delete:hover { background: rgba(239,68,68,0.25); color: #f87171; }

    #ssa-actions {
      padding: 8px 14px 12px; border-top: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;
      display: flex; gap: 8px;
    }
    .ssa-action-btn {
      display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px;
      font-size: 11px; font-weight: 600; color: #22d3ee; background: rgba(34,211,238,0.1);
      border: 1px solid rgba(34,211,238,0.2); border-radius: 8px; cursor: pointer;
      transition: all 0.15s; font-family: inherit;
    }
    .ssa-action-btn:hover:not(:disabled) { background: rgba(34,211,238,0.2); }
    .ssa-action-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .ssa-loading { text-align: center; color: #22d3ee; font-size: 12px; padding: 40px 10px; }
    .ssa-loading::after {
      content: ''; display: inline-block; width: 14px; height: 14px;
      border: 2px solid rgba(34,211,238,0.3); border-top-color: #22d3ee;
      border-radius: 50%; animation: ssa-spin 0.7s linear infinite;
      margin-left: 8px; vertical-align: middle;
    }
    @keyframes ssa-spin { to { transform: rotate(360deg); } }
  `;

  document.documentElement.appendChild(style);
  document.documentElement.appendChild(panel);

  // --- Drag logic ---
  let isDragging = false, offsetX, offsetY;
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
    let x = e.clientX - offsetX;
    let y = e.clientY - offsetY;
    x = Math.max(0, Math.min(window.innerWidth - 100, x));
    y = Math.max(0, Math.min(window.innerHeight - 50, y));
    panel.style.left = x + "px";
    panel.style.top = y + "px";
    panel.style.right = "auto";
  });

  document.addEventListener("mouseup", () => {
    if (isDragging) { isDragging = false; panel.classList.remove("ssa-dragging"); }
  });

  // --- Tab switching ---
  panel.querySelectorAll(".ssa-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      panel.querySelectorAll(".ssa-tab").forEach((t) => t.classList.remove("ssa-tab-active"));
      panel.querySelectorAll(".ssa-panel-section").forEach((s) => s.classList.remove("ssa-panel-active"));
      tab.classList.add("ssa-tab-active");
      panel.querySelector(`#ssa-${tab.dataset.tab}`).classList.add("ssa-panel-active");
      // Hide back button when switching tabs normally
      panel.querySelector("#ssa-back-btn").style.display = "none";
    });
  });

  // --- Minimize / Close ---
  panel.querySelector("#ssa-minimize").addEventListener("click", () => {
    panel.classList.toggle("ssa-minimized");
  });
  panel.querySelector("#ssa-close").addEventListener("click", () => {
    panel.style.display = "none";
  });

  // --- Export PDF ---
  panel.querySelector("#ssa-export-pdf").addEventListener("click", async () => {
    const data = await new Promise((resolve) => chrome.storage.local.get(["analysis"], resolve));
    const analysis = data.analysis;
    if (!analysis) { alert("No analysis data to export."); return; }

    try {
      const resp = await fetch("http://127.0.0.1:8000/export-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          simplified: analysis.simplified || "",
          questions: analysis.questions || [],
          keywords: analysis.keywords || [],
          difficulty: analysis.difficulty || ""
        })
      });
      if (!resp.ok) throw new Error("Server error");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "study_output.pdf"; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Could not export PDF. Is the backend running?");
    }
  });

  // --- Back button ---
  panel.querySelector("#ssa-back-btn").addEventListener("click", () => {
    panel.querySelector("#ssa-back-btn").style.display = "none";
    // Switch back to history tab
    panel.querySelectorAll(".ssa-tab").forEach((t) => t.classList.remove("ssa-tab-active"));
    panel.querySelectorAll(".ssa-panel-section").forEach((s) => s.classList.remove("ssa-panel-active"));
    panel.querySelector('[data-tab="history"]').classList.add("ssa-tab-active");
    panel.querySelector("#ssa-history").classList.add("ssa-panel-active");
    loadHistory();
  });

  // --- Load history on History tab click ---
  panel.querySelector('[data-tab="history"]').addEventListener("click", loadHistory);

  return panel;
}

async function deleteHistoryItem(index) {
  try {
    await fetch(`http://127.0.0.1:8000/history/${index}`, { method: "DELETE" });
    loadHistory();
  } catch (err) {
    alert("Could not delete. Is the backend running?");
  }
}

async function loadHistory() {
  const p = createPanel();
  const container = p.querySelector("#ssa-history");
  container.innerHTML = '<div class="ssa-loading">Loading history</div>';
  try {
    const resp = await fetch("http://127.0.0.1:8000/history");
    const items = await resp.json();
    historyCache = items;
    if (!items.length) {
      container.innerHTML = '<div class="ssa-empty">No history yet</div>';
      return;
    }
    container.innerHTML = items.map((item, i) => `
      <div class="ssa-history-item" data-index="${i}">
        <div class="ssa-history-item-content">
          <div class="ssa-history-text">${item.input || item.text || ""}</div>
          <div class="ssa-history-meta">
            <span class="ssa-history-tag">${item.difficulty || "?"}</span>
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

    // Click on content to open detail
    container.querySelectorAll(".ssa-history-item-content").forEach((el) => {
      el.addEventListener("click", () => {
        const idx = parseInt(el.parentElement.dataset.index);
        openHistoryDetail(historyCache[idx]);
      });
    });

    // Click delete button
    container.querySelectorAll(".ssa-history-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.deleteIndex);
        deleteHistoryItem(idx);
      });
    });
  } catch (err) {
    container.innerHTML = '<div class="ssa-empty">Backend offline</div>';
  }
}

function openHistoryDetail(item) {
  const p = createPanel();

  // Store the input text for PDF export
  chrome.storage.local.set({ currentText: item.input || item.text || "" });

  // Show results in tabs (simplified, questions, keywords, difficulty)
  showResults(item);

  // Switch to simplified tab
  p.querySelectorAll(".ssa-tab").forEach((t) => t.classList.remove("ssa-tab-active"));
  p.querySelectorAll(".ssa-panel-section").forEach((s) => s.classList.remove("ssa-panel-active"));
  p.querySelector('[data-tab="simplified"]').classList.add("ssa-tab-active");
  p.querySelector("#ssa-simplified").classList.add("ssa-panel-active");

  // Show back button & enable export
  p.querySelector("#ssa-back-btn").style.display = "inline-flex";
  p.querySelector("#ssa-export-pdf").disabled = false;
}

// --- Toggle panel via extension icon click ---
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "toggle-panel") {
    const p = createPanel();
    p.style.display = p.style.display === "none" ? "flex" : "none";
    if (p.classList.contains("ssa-minimized")) p.classList.remove("ssa-minimized");
  }
});

function showLoading() {
  const p = createPanel();
  p.style.display = "flex";
  p.querySelector("#ssa-simplified").innerHTML = '<div class="ssa-loading">Analyzing</div>';
  p.querySelector("#ssa-questions").innerHTML = '<div class="ssa-loading">Generating</div>';
  p.querySelector("#ssa-keywords").innerHTML = '<div class="ssa-loading">Extracting</div>';
  p.querySelector("#ssa-difficulty").innerHTML = '<div class="ssa-loading">Detecting</div>';
}

function showResults(result) {
  const p = createPanel();

  if (result.simplified) {
    p.querySelector("#ssa-simplified").innerHTML = `<div class="ssa-text">${result.simplified}</div>`;
  }

  if (result.questions && result.questions.length) {
    p.querySelector("#ssa-questions").innerHTML = result.questions
      .map((q, i) => `<div class="ssa-q-item"><div class="ssa-q-num">${i + 1}</div><div class="ssa-q-text">${q}</div></div>`)
      .join("");
  }

  if (result.keywords && result.keywords.length) {
    p.querySelector("#ssa-keywords").innerHTML = `<div class="ssa-kw-grid">${result.keywords.map((k) => `<span class="ssa-kw-tag">${k}</span>`).join("")}</div>`;
  }

  if (result.difficulty) {
    const level = result.difficulty.toLowerCase();
    p.querySelector("#ssa-difficulty").innerHTML = `<div class="ssa-difficulty-badge ssa-difficulty-${level}">${level === "easy" ? "🟢" : level === "medium" ? "🟡" : "🔴"} ${result.difficulty}</div>`;
  }

  p.querySelector("#ssa-export-pdf").disabled = false;
}

async function sendTextToBackend(text) {
  const response = await fetch("http://127.0.0.1:8000/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  return await response.json();
}

document.addEventListener("mouseup", async (e) => {
  if (e.target.closest && e.target.closest("#ssa-panel")) return;

  const selectedText = window.getSelection().toString().trim();
  if (selectedText.length > 20) {
    showLoading();
    try {
      const result = await sendTextToBackend(selectedText);
      chrome.storage.local.set({ analysis: result, currentText: selectedText });
      showResults(result);
      // Hide back button for fresh analysis
      createPanel().querySelector("#ssa-back-btn").style.display = "none";
    } catch (err) {
      createPanel().querySelector("#ssa-simplified").innerHTML = '<div class="ssa-empty">Backend offline — start the server first</div>';
    }
  }
});
