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
| 📝 **Text Simplification** | Breaks down complex paragraphs using Google's Flan-T5 model |
| ❓ **Question Generation** | Auto-generates up to 5 practice questions from selected text |
| 🔑 **Keyword Extraction** | Identifies key nouns and proper nouns using spaCy |
| 📊 **Difficulty Detection** | Classifies text as Easy, Medium, or Hard |
| 📜 **Analysis History** | Persistent history — browse, revisit, or delete entries |
| 📄 **PDF Export** | Export analysis as a clean formatted PDF |
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
│       ├── simplifier.py              # Text simplification (Flan-T5 + fallback)
│       ├── question_generator.py      # Question generation (Flan-T5)
│       ├── keyword_extractor.py       # Keyword extraction (spaCy POS)
│       ├── difficulty_detector.py     # Easy / Medium / Hard classifier
│       ├── pdf_exporter.py            # FPDF2 PDF generation
│       └── history_manager.py         # JSON-backed history CRUD
│
├── extension/
│   ├── manifest.json                  # Chrome/Edge Manifest V3
│   ├── background.js                  # Service worker — icon click handler
│   ├── content.js                     # In-page draggable panel + UI logic
│   └── icon.png                       # Extension icon
│
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- **Python 3.10+**
- **Google Chrome** or **Microsoft Edge**
- **pip** package manager

### 1️⃣ Backend Setup

```bash
git clone https://github.com/yourusername/smart-study-assistant.git
cd smart-study-assistant/backend

pip install -r requirements.txt

# Start the server
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

> 💡 On first run, the Flan-T5 model (~990 MB) downloads automatically. spaCy's `en_core_web_sm` is installed via `requirements.txt`.

### 2️⃣ Extension Setup (Chrome or Edge)

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

1. **Select any text** (20+ characters) on a webpage
2. The **floating panel** appears with analysis results
3. Switch tabs: **Simplified**, **Questions**, **Keywords**, **Difficulty**
4. Click **Export PDF** to download a formatted report
5. Visit **History** to review past analyses
6. Click any history entry to view full details
7. Use 🗑️ to delete individual entries

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/analyze` | Analyze text → simplified, questions, keywords, difficulty |
| `GET` | `/history` | List all past analyses |
| `DELETE` | `/history/{index}` | Delete a specific history entry |
| `POST` | `/export-pdf` | Generate & download a PDF report |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| 🤖 **NLP Model** | Google Flan-T5 Base (HuggingFace Transformers) |
| 🔤 **NLP Processing** | spaCy (en_core_web_sm) + NLTK |
| ⚡ **Backend** | FastAPI + Uvicorn |
| 📄 **PDF Generation** | FPDF2 |
| 🌐 **Extension** | Chrome/Edge Manifest V3, Vanilla JS |

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
