"""
nlp_service.py — Orchestrator: wires models into sub-modules and exposes
                 the single public entry point `analyze_text()`.

Sub-modules:
    model_loader       — spaCy + Flan-T5 singleton
    simplifier         — sentence-by-sentence simplification
    question_generator — practice question generation
    keyword_extractor  — noun/proper-noun extraction
    difficulty_detector— Easy / Medium / Hard classification
    pdf_exporter       — FPDF2-based PDF generation
    history_manager    — JSON-backed history CRUD
"""

import nltk

nltk.download("punkt", quiet=True)
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

# ── Bootstrap: inject models into modules that need them ─────────────────────
_nlp, _generator = get_models()
simplifier.init(_nlp, _generator)
question_generator.init(_generator)
keyword_extractor.init(_nlp)
# difficulty_detector and pdf_exporter are stateless — no init needed

# ── Public re-exports (so main.py import surface doesn't change) ─────────────
export_to_pdf = pdf_exporter.export_to_pdf
get_history = history_manager.get_history
save_history = history_manager.save_history
delete_history_item = history_manager.delete_history_item


# ── Main analysis entry point ─────────────────────────────────────────────────
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
    questions = question_generator.generate_questions(text)
    keywords = keyword_extractor.extract_keywords(text)
    difficulty = difficulty_detector.detect_difficulty(text)

    result = {
        "simplified": simplified,
        "questions": questions,
        "keywords": keywords,
        "difficulty": difficulty,
    }

    history_manager.save_history({"input": text, **result})
    return result
