# services/nlp_service.py

from nlp_engine.pipeline.pipeline import analyze_text

def analyze_text(text: str):
    simplified = simplify_text(text)
    questions = generate_questions(text)
    keywords = extract_keywords(text)

    return {
        "simplified": simplified,
        "questions": questions,
        "keywords": keywords
    }