"""
nlp_service.py — Orchestrator: wires models into sub-modules and exposes
                 the single public entry point `analyze_text()`.

CHANGE: question_generator.init() now also receives the spaCy nlp model
        so it can extract named-entity / noun-chunk answer spans, which
        produces far more specific questions from Flan-T5.
"""

import nltk

nltk.download("punkt",     quiet=True)
nltk.download("punkt_tab", quiet=True)

from services.model_loader import get_models
from services import (
    simplifier,
    question_generator,
    keyword_extractor,
    difficulty_detector,
    pdf_exporter,
    history_manager,
)

# ── Bootstrap ────────────────────────────────────────────────────────────────
_nlp, _generator = get_models()

simplifier.init(_nlp, _generator)

# Pass both the Flan-T5 pipeline AND the spaCy model so question_generator
# can extract named-entity / noun-chunk answer spans for better prompts.
question_generator.init(_generator, nlp_model=_nlp)

keyword_extractor.init(_nlp)

# ── Public re-exports ────────────────────────────────────────────────────────
export_to_pdf       = pdf_exporter.export_to_pdf
get_history         = history_manager.get_history
save_history        = history_manager.save_history
delete_history_item = history_manager.delete_history_item


# ── Main analysis entry point ────────────────────────────────────────────────
def analyze_text(text: str) -> dict:
    """
    Run all NLP tasks on *text* and persist the result to history.

    Returns:
        {
            "simplified": str,
            "questions":  list[str],
            "keywords":   list[str],
            "difficulty": str,
        }
    """
    simplified = simplifier.simplify_text(text)
    questions  = question_generator.generate_questions(text)
    keywords   = keyword_extractor.extract_keywords(text)
    difficulty = difficulty_detector.detect_difficulty(text)

    result = {
        "simplified": simplified,
        "questions":  questions,
        "keywords":   keywords,
        "difficulty": difficulty,
    }

    history_manager.save_history({"input": text, **result})
    return result