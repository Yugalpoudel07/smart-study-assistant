<div align="center">

# 🧠 Smart Study Assistant

### _AI-Powered Learning Companion — Chrome/Edge Extension + FastAPI Backend_

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Chrome Extension](https://img.shields.io/badge/Chrome%2FEdge-Extension_MV3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/)
[![HuggingFace](https://img.shields.io/badge/HuggingFace-Transformers-FFD21E?style=for-the-badge&logo=huggingface&logoColor=black)](https://huggingface.co)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

> **Select any text on the web → Get instant simplification, practice questions, keywords, and difficulty analysis — inside a sleek draggable panel.**

</div>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 📝 **Text Simplification** | Breaks down complex paragraphs using Groq-hosted Flan-T5 inference |
| ❓ **Question Generation** | Auto-generates up to 5 practice questions from selected text |
| 🔑 **Keyword Extraction** | Identifies key nouns and proper nouns using spaCy |
| 📊 **Difficulty Detection** | Classifies text as Easy, Medium, or Hard (words/sentence + Flesch-Kincaid) |
| 📜 **Analysis History** | Persistent history with UUID-based IDs — browse, search, revisit, or delete |
| 📄 **PDF Export** | Export analysis as a clean formatted PDF |
| 📋 **Markdown Export** | Client-side export to `.md` — no backend needed |
| ⌨️ **Keyboard Shortcut** | `Alt+S` toggles the panel from anywhere on the page |
| 🔍 **History Search** | Filter past analyses client-side as you type |
| ⚙️ **Options Page** | Configure API URL, max chars, and PDF redirect in the extension settings |
| 🖱️ **Draggable Panel** | Floating, resizable, minimizable in-page UI |

---

## 🏗️ Architecture

```
smart-study-assistant/
│
├── backend/
│   ├── main.py                        # FastAPI server + all API endpoints
│   ├── requirements.txt
│   └── services/
│       ├── __init__.py
│       ├── nlp_service.py             # Orchestrator — wires all modules together
│       ├── model_loader.py            # Singleton loader for spaCy + Flan-T5
│       ├── simplifier.py              # Text simplification (Groq API + spaCy fallback)
│       ├── question_generator.py      # Question generation (Flan-T5, single-pass)
│       ├── keyword_extractor.py       # Keyword extraction (spaCy POS + NER)
│       ├── difficulty_detector.py     # Easy / Medium / Hard (WPS + Flesch-Kincaid)
│       ├── pdf_exporter.py            # FPDF2 PDF generation (writes to /tmp)
│       └── history_manager.py         # JSON-backed history CRUD (UUID IDs, thread-safe)
│
├── extension/
│   ├── manifest.json                  # Chrome/Edge Manifest V3
│   ├── background.js                  # Service worker — icon click, keyboard shortcut, PDF intercept
│   ├── content.js                     # In-page draggable panel + all UI logic
│   ├── options.html                   # Extension settings page
│   ├── options.js                     # Options page logic
│   ├── icon16.png                     # ⚠ Must be created manually (16×16 px)
│   ├── icon48.png                     # ⚠ Must be created manually (48×48 px)
│   └── icon128.png                    # ⚠ Must be created manually (128×128 px)
│
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- **Python 3.10+**
- **Google Chrome** or **Microsoft Edge**
- **pip** package manager
- **Groq API key** — free at [console.groq.com](https://console.groq.com)

### 1️⃣ Backend Setup

```bash
git clone https://github.com/yourusername/smart-study-assistant.git
cd smart-study-assistant/backend

pip install -r requirements.txt

# Create the .env file with your Groq API key
echo "GROQ_API_KEY=your_key_here" > .env

# Start the server
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

> 💡 On first run, the Flan-T5 model (~990 MB) downloads automatically. spaCy's `en_core_web_sm` is installed via `requirements.txt`.

### 2️⃣ Icon Files

Before loading the extension, create the three icon files at the correct pixel dimensions:

| File | Size | Tool |
|------|------|------|
| `extension/icon16.png` | 16×16 px | Figma, favicon.io, or any image editor |
| `extension/icon48.png` | 48×48 px | Figma, favicon.io, or any image editor |
| `extension/icon128.png` | 128×128 px | Figma, favicon.io, or any image editor |

These files are **not** auto-generated and must be placed in the `extension/` folder manually.

### 3️⃣ Extension Setup (Chrome or Edge)

**Chrome:**
1. Go to `chrome://extensions`
2. Enable **Developer Mode**
3. Click **Load unpacked** → select the `extension/` folder

**Microsoft Edge:**
1. Go to `edge://extensions`
2. Enable **Developer Mode**
3. Click **Load unpacked** → select the `extension/` folder

> ✅ The `manifest.json` is Manifest V3 compliant and accepted by both Chrome Web Store and Microsoft Edge Add-ons store.

---

## 🎯 How to Use

1. **Select any text** (20–5,000 characters) on a webpage
2. The **floating panel** appears with analysis results
3. Switch tabs: **Simplified**, **Questions**, **Keywords**, **Difficulty**
4. Click **Export PDF** to download a formatted PDF report
5. Click **Export MD** to download a Markdown report (no backend needed)
6. Visit **History** to review past analyses
7. **Search** past analyses using the filter box at the top of the History tab
8. Click any history entry to view full details
9. Use 🗑️ to delete individual entries
10. Press **Alt+S** anywhere on the page to toggle the panel open/closed

---

## ⌨️ Keyboard Shortcut

| Shortcut | Action |
|----------|--------|
| `Alt+S` | Toggle the Smart Study Assistant panel open / closed |

The shortcut is also documented in the panel's status bar. You can change it in `chrome://extensions/shortcuts`.

---

## ⚙️ Options Page

Open the options page via `chrome://extensions` → **Smart Study Assistant** → **Details** → **Extension options**, or right-click the extension icon → **Options**.

| Setting | Default | Description |
|---------|---------|-------------|
| **API Base URL** | `http://127.0.0.1:8000` | URL of your local FastAPI backend. Change this if you run the backend on a different port or host. |
| **Max chars to analyze** | `5000` | Selected text longer than this is truncated before sending. A notice appears in the panel when truncation occurs. |
| **Enable PDF auto-redirect** | `true` | When enabled, PDF navigation is intercepted and redirected to the built-in PDF viewer. Disable if it conflicts with another PDF extension. |

Settings are stored in `chrome.storage.sync` and applied immediately on the next analysis.

---

## 📄 Markdown Export

Click **Export MD** next to the Export PDF button after any analysis. A `.md` file is downloaded immediately — no backend call is made. The format is:

```markdown
# Study Analysis

## Simplified Text
…

## Practice Questions
1. …

## Keywords
keyword1, keyword2, …

## Difficulty
Easy / Medium / Hard
```

---

## 🔍 History Search

The **History** tab now includes a search box at the top. Type any word or phrase to filter past analyses in real time. Matching is done client-side against the original input text — no backend request is made.

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/analyze` | Analyze text → simplified, questions, keywords, difficulty |
| `GET` | `/history` | List all past analyses (each entry has a UUID `id` field) |
| `DELETE` | `/history/{id}` | Delete a specific history entry by its UUID string |
| `POST` | `/export-pdf` | Generate & download a PDF report |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| 🤖 **NLP Model** | Google Flan-T5 Base (HuggingFace Transformers) |
| ⚡ **Inference** | Groq API (llama-3.1-8b-instant for simplification) |
| 🔤 **NLP Processing** | spaCy (en_core_web_sm) + NLTK |
| ⚡ **Backend** | FastAPI + Uvicorn |
| 📄 **PDF Generation** | FPDF2 |
| 🌐 **Extension** | Chrome/Edge Manifest V3, Vanilla JS |

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
