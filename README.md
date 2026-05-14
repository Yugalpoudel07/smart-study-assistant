<div align="center">

# 🧠 Smart Study Assistant

### _AI-Powered Learning Companion for Chrome & Edge_

[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.116-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Groq](https://img.shields.io/badge/Groq-llama--3.1--8b-F55036?style=for-the-badge&logo=groq&logoColor=white)](https://groq.com)
[![Manifest V3](https://img.shields.io/badge/Extension-Manifest_V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Render](https://img.shields.io/badge/Hosted_on-Render-46E3B7?style=for-the-badge&logo=render&logoColor=black)](https://render.com)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](LICENSE)

> **Select any text on any webpage → get instant AI simplification, practice questions, keywords, and difficulty analysis — inside a sleek floating panel. No local setup needed.**

</div>

---

## 🚀 Install in 3 Steps — No Setup Required

The backend is already hosted. Just download and load the extension.

### Step 1 — Download

Go to the [Releases](../../releases) page or grab **`extension.zip`** directly from this repo.

### Step 2 — Extract

Unzip `extension.zip` anywhere on your computer. You'll get an `extension/` folder.

### Step 3 — Load in your browser

**Microsoft Edge:**
1. Go to `edge://extensions`
2. Turn on **Developer mode** (bottom-left toggle)
3. Click **Load unpacked**
4. Select the extracted `extension/` folder

**Google Chrome:**
1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the extracted `extension/` folder

That's it. The extension icon appears in your toolbar. Click it on any webpage to get started.

> ⚠️ **First request may take 30–60 seconds** if the backend has been idle. Subsequent requests are fast. This is normal behaviour on the free hosting tier.

---

## ✨ Features

| Feature | Description |
|---|---|
| 📝 **Text Simplification** | Rewrites complex paragraphs into plain English using Groq-hosted LLaMA 3.1 (Flan-T5 prompt architecture) |
| ❓ **Question Generation** | Auto-generates up to 5 practice questions from your selected text |
| 🔑 **Keyword Extraction** | Identifies key nouns and named entities using spaCy NLP |
| 📊 **Difficulty Detection** | Classifies text as Easy / Medium / Hard using words-per-sentence + Flesch-Kincaid scoring |
| 📜 **Analysis History** | Stores past analyses with UUID-based IDs — browse, search, revisit, and delete entries |
| 🔍 **History Search** | Filter past analyses in real time — entirely client-side, no backend call needed |
| 📄 **PDF Export** | Export any analysis as a formatted PDF report |
| 📋 **Markdown Export** | Download analysis as a `.md` file — works offline, no backend call needed |
| 📑 **Built-in PDF Viewer** | Automatically intercepts PDF links and opens them in a viewer with selectable text + analysis panel |
| ⌨️ **Keyboard Shortcut** | `Alt+S` toggles the panel from anywhere on the page |
| 🖱️ **Draggable Panel** | Floating, draggable, minimizable in-page panel — stays out of your way |
| ⚙️ **Options Page** | Configure the API URL, character limit, and PDF redirect behaviour |

---

## 🎯 How to Use

1. Navigate to any article, Wikipedia page, research paper, or PDF
2. **Select any text** (between 20 and 5,000 characters)
3. The **Smart Study Assistant panel** appears automatically with your results
4. Switch between tabs:
   - **Simplified** — plain English rewrite of your selection
   - **Questions** — practice questions to test your understanding
   - **Keywords** — key terms extracted from the text
   - **Difficulty** — Easy / Medium / Hard rating with explanation
5. Click **Export PDF** to download a formatted report
6. Click **Export MD** to download a Markdown file (no internet needed)
7. Open the **History** tab to revisit any past analysis
8. Use the **search box** in History to filter by keyword
9. Press **Alt+S** anywhere to toggle the panel open or closed

---

## 🏗️ Architecture

```
smart-study-assistant/
│
├── extension/                         ← Load this folder in Chrome/Edge
│   ├── manifest.json                  # Manifest V3 — permissions, shortcuts, icons
│   ├── background.js                  # Service worker: icon click, Alt+S, PDF intercept
│   ├── content.js                     # Floating panel + all in-page UI and analysis logic
│   ├── options.html / options.js      # Extension settings page
│   ├── pdf_viewer.html / pdf_viewer.js# Built-in PDF viewer with analysis panel
│   ├── pdf.js / pdf.worker.js         # Mozilla PDF.js renderer
│   └── icon16/48/128.png              # Extension icons
│
├── backend/                           ← Hosted on Render (no local setup needed)
│   ├── main.py                        # FastAPI app — all API endpoints
│   ├── requirements.txt
│   └── services/
│       ├── nlp_service.py             # Orchestrator — wires all modules
│       ├── model_loader.py            # Singleton loader for spaCy
│       ├── simplifier.py              # Groq LLaMA 3.1 simplification + spaCy fallback
│       ├── question_generator.py      # Flan-T5 style question generation via Groq
│       ├── keyword_extractor.py       # spaCy POS tagging + NER
│       ├── difficulty_detector.py     # Flesch-Kincaid + words-per-sentence scoring
│       ├── pdf_exporter.py            # FPDF2 PDF generation (temp file + auto-cleanup)
│       └── history_manager.py         # Thread-safe history CRUD (ephemeral mode on Render)
│
├── render.yaml                        # Render deployment config
├── build.sh                           # Render build script
├── .python-version                    # Pins Python 3.11.9 for Render
└── extension.zip                      ← Download this to install the extension
```

---

## 🔌 Backend API

The backend is live at:
```
https://smart-study-assistant-9u6m.onrender.com
```

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/analyze` | Analyze text → returns simplified, questions, keywords, difficulty |
| `GET` | `/history` | List all stored analyses |
| `DELETE` | `/history/{id}` | Delete a history entry by its UUID |
| `POST` | `/export-pdf` | Generate and stream a PDF report |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| ⚡ **AI Inference** | [Groq API](https://groq.com) — LLaMA 3.1 8B Instant |
| 🧠 **Prompting Strategy** | Flan-T5 instruction-tuning architecture (sentence routing, quality guards, fallback) |
| 🔤 **NLP Processing** | [spaCy](https://spacy.io) `en_core_web_sm` — keyword extraction, POS tagging, NER |
| 📏 **Difficulty Scoring** | Flesch-Kincaid readability + words-per-sentence classification |
| ⚡ **Backend Framework** | [FastAPI](https://fastapi.tiangolo.com) + Uvicorn |
| 📄 **PDF Generation** | [FPDF2](https://pyfpdf.github.io/fpdf2/) — streamed with auto-cleanup |
| 🌐 **Extension** | Chrome/Edge Manifest V3 — Vanilla JS, no frameworks |
| 📑 **PDF Rendering** | [Mozilla PDF.js](https://mozilla.github.io/pdf.js/) |
| ☁️ **Hosting** | [Render](https://render.com) free tier — Singapore region |

---

## ⚙️ Options Page

Right-click the extension icon → **Options** (or go to `edge://extensions` → Smart Study Assistant → Details → Extension options).

| Setting | Default | Description |
|---|---|---|
| **API Base URL** | Hosted Render URL | The backend URL. Only change this if you're running the backend locally. |
| **Max chars to analyze** | `5000` | Text longer than this is trimmed before sending. A notice appears in the panel when trimming occurs. |
| **Enable PDF auto-redirect** | On | When on, PDF links are intercepted and opened in the built-in viewer. Turn off if it conflicts with another PDF extension. |

---

## ⌨️ Keyboard Shortcut

| Shortcut | Action |
|---|---|
| `Alt+S` | Toggle the Smart Study Assistant panel open / closed |

You can change or reassign this in `edge://extensions/shortcuts` (or `chrome://extensions/shortcuts`).

---

## 🖥️ Running the Backend Locally (Optional)

You don't need to do this — the hosted backend works out of the box. But if you want to run it yourself:

**Prerequisites:** Python 3.11, a free [Groq API key](https://console.groq.com)

```bash
git clone https://github.com/yourusername/smart-study-assistant.git
cd smart-study-assistant/backend

pip install -r requirements.txt
python -m spacy download en_core_web_sm

# Create .env with your key
echo "GROQ_API_KEY=your_key_here" > .env

uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Then open the extension Options page and change the API Base URL to `http://127.0.0.1:8000`.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.