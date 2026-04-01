import os
import re
import json
from fpdf import FPDF
import anthropic

# Initialize Claude client
# Set your ANTHROPIC_API_KEY environment variable on Render
client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

MODEL = "claude-haiku-4-5-20251001"  # Fast + cheap — ideal for this use case

# -------------------------------
# 1. SIMPLIFICATION
# -------------------------------
def simplify_text(text):
    message = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": (
                    "Simplify the following text so a high school student can understand it easily. "
                    "Keep the meaning intact. Return only the simplified text, no preamble.\n\n"
                    f"{text}"
                )
            }
        ]
    )
    return message.content[0].text.strip()


# -------------------------------
# 2. QUESTION GENERATION
# -------------------------------
def generate_questions(text):
    message = client.messages.create(
        model=MODEL,
        max_tokens=512,
        messages=[
            {
                "role": "user",
                "content": (
                    "Generate up to 5 study questions based on the following text. "
                    "Return them as a numbered list, one per line, ending each with a question mark. "
                    "No preamble, just the questions.\n\n"
                    f"{text}"
                )
            }
        ]
    )
    raw = message.content[0].text.strip()
    lines = raw.split("\n")
    questions = []
    for line in lines:
        # Strip leading numbers like "1. " or "1) "
        q = re.sub(r"^\d+[\.\)]\s*", "", line).strip()
        if len(q) > 10:
            if not q.endswith("?"):
                q += "?"
            questions.append(q)
    return questions[:5] if questions else ["Could not generate questions. Try a longer paragraph."]


# -------------------------------
# 3. KEYWORD EXTRACTION
# -------------------------------
def extract_keywords(text):
    message = client.messages.create(
        model=MODEL,
        max_tokens=256,
        messages=[
            {
                "role": "user",
                "content": (
                    "Extract the 8 to 12 most important keywords or key phrases from the following text. "
                    "Return them as a comma-separated list on a single line. No preamble.\n\n"
                    f"{text}"
                )
            }
        ]
    )
    raw = message.content[0].text.strip()
    keywords = [kw.strip().lower() for kw in raw.split(",") if kw.strip()]
    return keywords[:12]


# -------------------------------
# 4. DIFFICULTY DETECTION
# -------------------------------
def detect_difficulty(text):
    message = client.messages.create(
        model=MODEL,
        max_tokens=16,
        messages=[
            {
                "role": "user",
                "content": (
                    "Rate the reading difficulty of the following text. "
                    "Reply with exactly one word: Easy, Medium, or Hard.\n\n"
                    f"{text}"
                )
            }
        ]
    )
    raw = message.content[0].text.strip()
    # Normalize to one of the three levels
    for level in ["Easy", "Medium", "Hard"]:
        if level.lower() in raw.lower():
            return level
    return "Medium"  # safe fallback


# -------------------------------
# 5. EXPORT TO PDF
# -------------------------------
def export_to_pdf(data, filename="output.pdf"):
    pdf = FPDF()
    pdf.add_page()
    pdf.set_margins(15, 15, 15)
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.set_font("Arial", size=12)

    page_width = pdf.w - 30

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

    pdf.set_font("Arial", style='B', size=14)
    pdf.cell(page_width, 12, "Smart Study Assistant Output", ln=True, align='C')
    pdf.ln(4)

    write_heading("Simplified Text:")
    write_body(data.get("simplified", ""))
    pdf.ln(2)

    write_heading("Questions:")
    for q in data.get("questions", []):
        q = q.strip()
        if q:
            write_body(f"- {q}")
    pdf.ln(2)

    write_heading("Keywords:")
    keywords_text = ", ".join(data.get("keywords", []))
    write_body(keywords_text)
    pdf.ln(2)

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
            except Exception:
                history = []
    history.append(entry)
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2)

def get_history():
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            try:
                return json.load(f)
            except Exception:
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
