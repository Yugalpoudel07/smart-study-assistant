<div align="center">

# 🧠 Smart Study Assistant

### _AI-Powered Learning Companion — Chrome/Edge Extension + FastAPI on Render_

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Claude API](https://img.shields.io/badge/Claude-API-D97706?style=for-the-badge)](https://anthropic.com)
[![Render](https://img.shields.io/badge/Hosted_on-Render-46E3B7?style=for-the-badge)](https://render.com)
[![Edge Extension](https://img.shields.io/badge/Chrome%2FEdge-MV3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/)

> **Select any text → instant AI simplification, questions, keywords & difficulty — powered by Claude, hosted on Render.**

</div>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 📝 **Text Simplification** | Rewrites complex text in plain language using Claude |
| ❓ **Question Generation** | Auto-generates 5 practice questions |
| 🔑 **Keyword Extraction** | Pulls key concepts from the text |
| 📊 **Difficulty Detection** | Easy / Medium / Hard classification |
| 📜 **Analysis History** | Browse and revisit past analyses |
| 📄 **PDF Export** | Download a formatted study report |
| 🔛 **ON/OFF Toggle** | User controls when analysis runs |
| 🖱️ **Draggable Panel** | Floating, resizable, minimizable UI |

---

## 🏗️ Architecture

```
Chrome/Edge Extension
       │
       │  HTTPS (fetch)
       ▼
FastAPI on Render  ──►  Anthropic Claude API
   (50 MB RAM)            (does all NLP)
       │
       ▼
  history.json (local to Render instance)
```

**Old architecture:** Extension → Local FastAPI + spaCy + Flan-T5 (~4 GB RAM)
**New architecture:** Extension → Render FastAPI (~50 MB RAM) → Claude API

---

## 🏗️ Project Structure

```
smart-study-assistant/
│
├── render.yaml                        # Render deployment config
│
├── backend/
│   ├── main.py                        # FastAPI server + all API endpoints
│   ├── requirements.txt               # Minimal deps (~80 MB install)
│   └── services/
│       ├── __init__.py
│       ├── nlp_service.py             # Claude API integration (replaces all local models)
│       ├── pdf_exporter.py            # FPDF2 PDF generation
│       └── history_manager.py         # JSON-backed history CRUD
│
├── extension/
│   ├── manifest.json                  # Chrome/Edge Manifest V3
│   ├── background.js                  # Service worker
│   ├── content.js                     # In-page panel + UI logic
│   └── icon.png
│
└── README.md
```

---

## 🚀 Deployment Guide

### Step 1 — Deploy Backend to Render

1. Push this repo to **GitHub**
2. Go to [render.com](https://render.com) → **New Web Service**
3. Connect your GitHub repo
4. Render auto-detects `render.yaml` — click **Deploy**
5. In the Render dashboard → **Environment** → add:
   ```
   ANTHROPIC_API_KEY = sk-ant-api03-...your-new-key...
   ```
6. Copy your Render URL: `https://YOUR-APP-NAME.onrender.com`

> ⚠️ **Never commit your API key.** Set it only in the Render dashboard environment variables.

### Step 2 — Update Extension with Your Render URL

Open `extension/content.js` and update line 10:

```js
// Change this:
const API_BASE = "https://YOUR-APP-NAME.onrender.com";

// To your actual Render URL, e.g.:
const API_BASE = "https://smart-study-assistant-api.onrender.com";
```

### Step 3 — Load Extension in Edge/Chrome

**Chrome:**
1. Go to `chrome://extensions`
2. Enable **Developer Mode**
3. Click **Load unpacked** → select the `extension/` folder

**Microsoft Edge:**
1. Go to `edge://extensions`
2. Enable **Developer Mode**
3. Click **Load unpacked** → select the `extension/` folder

---

## 🎯 How to Use

1. Click the extension icon to open the panel
2. **Toggle ON** the AI Analysis switch (gray → green)
3. **Select any text** (20+ characters) on any webpage
4. Results appear instantly: Simplified, Questions, Keywords, Difficulty
5. Click **Export PDF** to download a formatted report
6. Visit **History** tab to review past analyses

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Render health check |
| `POST` | `/analyze` | Analyze text via Claude API |
| `GET` | `/history` | List past analyses |
| `DELETE` | `/history/{index}` | Delete a history entry |
| `POST` | `/export-pdf` | Download PDF report |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| 🤖 **AI** | Anthropic Claude (claude-sonnet-4-20250514) |
| ⚡ **Backend** | FastAPI + Uvicorn |
| ☁️ **Hosting** | Render (free tier, ~50 MB RAM) |
| 📄 **PDF** | FPDF2 |
| 🌐 **Extension** | Chrome/Edge Manifest V3, Vanilla JS |

---

## 🔐 Security Notes

- API key is stored **only** in Render's environment variables
- Extension fetches from Render over **HTTPS**
- No user data is stored beyond local `history.json` on the Render instance
- XSS protection on all rendered content in the extension panel

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
