"""
model_loader.py — Lazy singleton loader for spaCy model only.

Flan-T5 question generation is now handled via the DeepInfra
Inference API in question_generator.py — no local pipeline needed
and no Hugging Face credentials required here.
"""

import os
import spacy
from dotenv import load_dotenv

load_dotenv()

_nlp = None


def get_models():
    """Return (nlp, None) — spaCy loaded once, no local Flan-T5 pipeline."""
    global _nlp

    if _nlp is None:
        print("[model_loader] Loading spaCy en_core_web_sm …")
        _nlp = spacy.load("en_core_web_sm")
        print("[model_loader] spaCy loaded.")

    return _nlp, None   # None keeps the (nlp, generator) tuple API intact