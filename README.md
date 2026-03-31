<div align="center">

# 🧠 Smart Study Assistant

### _AI-Powered Learning Companion — Chrome Extension + FastAPI Backend_

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension_MV3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/)
[![HuggingFace](https://img.shields.io/badge/HuggingFace-Transformers-FFD21E?style=for-the-badge&logo=huggingface&logoColor=black)](https://huggingface.co)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

<br/>

> **Select any text on the web → Get instant simplification, practice questions, keywords, and difficulty analysis — all inside a sleek draggable panel.**

<br/>

<img src="https://img.shields.io/badge/status-active-success?style=flat-square" alt="status"/>
<img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs welcome"/>

---

</div>

## ✨ Features

| Feature | Description |
|---------|-------------|
| 📝 **Text Simplification** | Breaks down complex paragraphs into student-friendly language using Google's Flan-T5 model |
| ❓ **Question Generation** | Auto-generates up to 5 practice questions from any selected text |
| 🔑 **Keyword Extraction** | Identifies key nouns and proper nouns using spaCy NLP |
| 📊 **Difficulty Detection** | Classifies text as Easy, Medium, or Hard based on sentence complexity |
| 📜 **Analysis History** | Stores every analysis with full detail — browse, revisit, or delete anytime |
| 📄 **PDF Export** | Export simplified text, questions, keywords & difficulty as a clean PDF |
| 🖱️ **Draggable Panel** | Floating, resizable, minimizable in-page UI — works on any website |

---

## 🏗️ Architecture

```
smart-study-assistant/
│
├── backend/
│   ├── main.py                 # FastAPI server — API endpoints
│   └── services/
│       ├── __init__.py
│       └── nlp_service.py      # Core NLP logic (T5, spaCy, FPDF)
│
├── extension/
│   ├── manifest.json           # Chrome Extension Manifest V3
│   ├── background.js           # Service worker — icon click handler
│   ├── content.js              # In-page draggable panel + all UI logic
│   └── icon.png                # Extension icon
│
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- **Python 3.10+**
- **Google Chrome** (or any Chromium browser)
- **pip** package manager

### 1️⃣ Backend Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/smart-study-assistant.git
cd smart-study-assistant/backend

# Install dependencies
pip install fastapi uvicorn transformers torch spacy nltk fpdf2 pydantic

# Download spaCy model
python -m spacy download en_core_web_sm

# Start the server
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

> 💡 On first run, the Flan-T5 model (~990MB) will be downloaded automatically.

### 2️⃣ Extension Setup

1. Open **`chrome://extensions`** in Chrome
2. Enable **Developer Mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. Pin the extension to your toolbar — done! 🎉

---

## 🎯 How to Use

<div align="center">

```
Select text (20+ chars) on any webpage
         ↓
   Panel auto-appears
         ↓
  ┌──────────────────────────────┐
  │  📝 Simplified  │  ❓ Questions  │
  │  🔑 Keywords    │  📊 Difficulty │
  │  📜 History     │  📄 Export PDF │
  └──────────────────────────────┘
```

</div>

1. **Select any text** (minimum 20 characters) on a webpage
2. The **floating panel** appears automatically with analysis results
3. Switch between tabs: **Simplified**, **Questions**, **Keywords**, **Difficulty**
4. Click **Export PDF** to download a formatted report
5. Visit the **History** tab to review past analyses
6. Click any history entry to view full details, with a **Back** button to return
7. Use the 🗑️ button to delete individual history entries

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/analyze` | Analyze text → returns simplified, questions, keywords, difficulty |
| `GET` | `/history` | Retrieve all past analyses |
| `DELETE` | `/history/{index}` | Delete a specific history entry |
| `POST` | `/export-pdf` | Generate & download a PDF report |

### Example Request

```bash
curl -X POST http://127.0.0.1:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{"text": "Quantum computing leverages quantum mechanical phenomena such as superposition and entanglement to process information in fundamentally different ways than classical computers."}'
```

### Example Response

```json
{
  "simplified": "Quantum computing uses quantum physics to process information differently than regular computers.",
  "questions": [
    "What does quantum computing leverage?",
    "How is quantum computing different from classical computers?"
  ],
  "keywords": ["quantum", "computing", "superposition", "entanglement"],
  "difficulty": "Hard"
}
```

---

## 🛠️ Tech Stack

<div align="center">

| Layer | Technology |
|-------|-----------|
| 🤖 **NLP Model** | Google Flan-T5 Base (via HuggingFace Transformers) |
| 🔤 **NLP Processing** | spaCy (en_core_web_sm) + NLTK |
| ⚡ **Backend** | FastAPI + Uvicorn |
| 📄 **PDF Generation** | FPDF2 |
| 🌐 **Extension** | Chrome Manifest V3, Vanilla JS |
| 🎨 **UI** | Custom CSS — dark theme, draggable panel |

</div>

---

## 📸 Screenshots

> _Add screenshots of your extension panel here for extra impact!_
>
> Suggested screenshots:
> - Panel showing simplified text
> - Questions tab with generated questions
> - History tab with delete buttons
> - PDF export output

---

## 🤝 Contributing

Contributions are welcome! Feel free to:

1. 🍴 Fork the repository
2. 🔧 Create a feature branch (`git checkout -b feature/amazing-feature`)
3. 💾 Commit changes (`git commit -m 'Add amazing feature'`)
4. 📤 Push to branch (`git push origin feature/amazing-feature`)
5. 📬 Open a Pull Request

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

### ⭐ Star this repo if you found it useful!

Made with ❤️ for students everywhere

</div>
