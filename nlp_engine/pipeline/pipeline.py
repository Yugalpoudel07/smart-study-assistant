from nlp_engine.preprocessing.cleaner import clean_text
from nlp_engine.simplification.simplify import simplify_text
from nlp_engine.question_generation.qg import generate_questions
from nlp_engine.keyword_extraction.keywords import extract_keywords

cache = {}

def analyze_text(text: str):
    if text in cache:
        return cache[text]

    cleaned = clean_text(text)

    try:
        simplified = simplify_text(cleaned)
    except Exception:
        simplified = "Error simplifying text"

    try:
        questions = generate_questions(cleaned)
    except Exception:
        questions = ["Error generating questions"]

    try:
        keywords = extract_keywords(cleaned)
    except Exception:
        keywords = ["Error extracting keywords"]

    result = {
        "simplified": simplified,
        "questions": questions,
        "keywords": keywords
    }

    cache[text] = result
    return result