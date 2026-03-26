import torch
from transformers import pipeline
import spacy
import nltk
from nltk.tokenize import sent_tokenize
import re

nltk.download('punkt')
nltk.download('punkt_tab')

nlp = spacy.load("en_core_web_sm")

print("Loading models...")
generator = pipeline("text2text-generation", model="google/flan-t5-base")
print("Models loaded!")


# -------------------------------
# 1. SIMPLIFICATION
# -------------------------------
def simplify_text(text):
    prompt = f"Simplify this text for a student: {text}"

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
        return _fallback_simplify(text)

    original_words = set(text.lower().split())
    output_words = set(simplified.lower().split())
    overlap = len(original_words & output_words) / max(len(original_words), 1)

    if overlap > 0.85:
        return _fallback_simplify(text)

    return simplified


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
# 2. QUESTION GENERATION
# -------------------------------
def generate_questions(text):
    prompt = f"Generate questions based on this text: {text}"

    result = generator(
        prompt,
        max_new_tokens=200,
        num_beams=4,
        do_sample=False,
        early_stopping=True
    )

    raw_output = result[0]['generated_text']
    lines = re.split(r'\n|\?', raw_output)
    questions = []

    for line in lines:
        q = line.strip()
        if len(q) > 10:
            if not q.endswith("?"):
                q += "?"
            questions.append(q)

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
# 4. MAIN NLP SERVICE
# -------------------------------
def analyze_text(text):
    simplified = simplify_text(text)
    questions = generate_questions(text)
    keywords = extract_keywords(text)

    return {
        "simplified": simplified,
        "questions": questions,
        "keywords": keywords
    }