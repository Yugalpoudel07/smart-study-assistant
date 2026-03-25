from nlp_engine.preprocessing.preprocess import clean_text
from nlp_engine.simplification.simplify import simplify_text
from nlp_engine.question_generation.generate_questions import generate_questions
from nlp_engine.keyword_extraction.extract_keywords import extract_keywords

cache = {}

def analyze_text(text: str):
    if text in cache:
        return cache[text]

    cleaned = clean_text(text)

    simplified = simplify_text(cleaned)
    questions = generate_questions(cleaned)
    keywords = extract_keywords(cleaned)

    result = {
        "simplified": simplified,
        "questions": questions,
        "keywords": keywords
    }

    cache[text] = result
    return result