import torch
from transformers import pipeline
import spacy
import nltk
from nltk.tokenize import sent_tokenize
import re
import json
from fpdf import FPDF
import os


nltk.download('punkt')
nltk.download('punkt_tab')

nlp = spacy.load("en_core_web_sm")

print("Loading models...")
generator = pipeline("text2text-generation", model="google/flan-t5-base")
print("Models loaded!")

# -------------------------------
# 1. SIMPLIFICATION (sentence by sentence)
# -------------------------------
def simplify_text(text):
    sentences = sent_tokenize(text)
    simplified_sentences = []

    for sent in sentences:
        prompt = f"Simplify this text for a student: {sent}"

        result = generator(
            prompt,
            max_new_tokens=250,
            num_beams=4,
            do_sample=False,
            early_stopping=True
        )

        simplified = result[0]['generated_text'].strip()

        # fallback if output is too short or echoing
        if not simplified or len(simplified) < 10:
            simplified = _fallback_simplify(sent)

        original_words = set(sent.lower().split())
        output_words = set(simplified.lower().split())
        overlap = len(original_words & output_words) / max(len(original_words), 1)

        if overlap > 0.85:
            simplified = _fallback_simplify(sent)

        simplified_sentences.append(simplified)

    return " ".join(simplified_sentences)


def _fallback_simplify(text):
    """Rule-based simplification when model fails."""
    doc = nlp(text)
    simple_sentences = []

    for sent in doc.sents:
        sentence = sent.text.strip()
        parts = re.split(
            r'\b(however|therefore|furthermore|consequently|nevertheless)\b',
            sentence,
            flags=re.IGNORECASE
        )
        for part in parts:
            part = part.strip()
            if len(part.split()) > 5 and part.lower() not in [
                'however', 'therefore', 'furthermore', 'consequently', 'nevertheless'
            ]:
                simple_sentences.append(part)

    return " ".join(simple_sentences) if simple_sentences else text

# -------------------------------
# 2. QUESTION GENERATION (sentence by sentence)
# -------------------------------
def generate_questions(text):
    sentences = sent_tokenize(text)
    questions = []

    for sent in sentences:
        prompt = f"Generate questions based on this text: {sent}"

        result = generator(
            prompt,
            max_new_tokens=200,
            num_beams=4,
            do_sample=False,
            early_stopping=True
        )

        raw_output = result[0]['generated_text']
        lines = re.split(r'\n|\?', raw_output)

        for line in lines:
            q = line.strip()
            if len(q) > 10:
                if not q.endswith("?"):
                    q += "?"
                questions.append(q)

    # remove duplicates and limit
    questions = list(dict.fromkeys(questions))
    return questions[:5] if questions else ["Could not generate questions. Try a longer paragraph."]

# -------------------------------
# 3. KEYWORD EXTRACTION
# -------------------------------
def extract_keywords(text):
    doc = nlp(text)
    keywords = set()
    for token in doc:
        if token.pos_ in ["NOUN", "PROPN"] and not token.is_stop and len(token.text) > 2:
            keywords.add(token.text.lower())
    return list(keywords)

# -------------------------------
# 4. DIFFICULTY DETECTION
# -------------------------------
def detect_difficulty(text):
    sentences = sent_tokenize(text)
    total_words = sum(len(s.split()) for s in sentences)
    avg_words = total_words / max(len(sentences), 1)
    if avg_words < 12:
        return "Easy"
    elif avg_words < 20:
        return "Medium"
    else:
        return "Hard"

# -------------------------------
# 5. EXPORT TO PDF
# -------------------------------

def export_to_pdf(data, filename="output.pdf"):
    pdf = FPDF()
    pdf.add_page()
    pdf.set_margins(15, 15, 15)
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.set_font("Arial", size=12)

    page_width = pdf.w - 30  # subtract left + right margins

    def sanitize(text, max_word=40):
        text = re.sub(
            r'(\S{' + str(max_word) + r',})',
            lambda m: ' '.join(
                m.group(0)[i:i+max_word]
                for i in range(0, len(m.group(0)), max_word)
            ),
            text
        )
        return text.encode('latin-1', errors='replace').decode('latin-1')

    def write_heading(title):
        pdf.set_font("Arial", style='B', size=12)
        pdf.cell(page_width, 10, sanitize(title), ln=True, align='L')
        pdf.set_font("Arial", size=12)

    def write_body(text):
        try:
            pdf.multi_cell(page_width, 8, sanitize(text), align='L')
        except Exception:
            pass
        pdf.ln(2)

    # Title
    pdf.set_font("Arial", style='B', size=14)
    pdf.cell(page_width, 12, "Smart Study Assistant Output", ln=True, align='C')
    pdf.ln(4)

    # 1. Simplified Text
    write_heading("Simplified Text:")
    write_body(data.get("simplified", ""))
    pdf.ln(2)

    # 2. Questions
    write_heading("Questions:")
    for q in data.get("questions", []):
        q = q.strip()
        if q:
            write_body(f"- {q}")
    pdf.ln(2)

    # 3. Keywords
    write_heading("Keywords:")
    keywords_text = ", ".join(data.get("keywords", []))
    write_body(keywords_text)
    pdf.ln(2)

    # 4. Difficulty
    write_heading("Difficulty Level:")
    write_body(data.get("difficulty", ""))

    pdf.output(filename)
    return filename


# -------------------------------
# 6. HISTORY TRACKING
# -------------------------------
HISTORY_FILE = "history.json"

def save_history(entry):
    history = []
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            try:
                history = json.load(f)
            except:
                history = []
    history.append(entry)
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2)

def get_history():
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            try:
                return json.load(f)
            except:
                return []
    return []

# -------------------------------
# 7. MAIN NLP SERVICE
# -------------------------------
def analyze_text(text):
    simplified = simplify_text(text)
    questions = generate_questions(text)
    keywords = extract_keywords(text)
    difficulty = detect_difficulty(text)

    result = {
        "simplified": simplified,
        "questions": questions,
        "keywords": keywords,
        "difficulty": difficulty
    }

    save_history({"input": text, **result})
    return result