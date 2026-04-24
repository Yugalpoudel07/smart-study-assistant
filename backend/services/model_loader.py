"""
model_loader.py — Lazy singleton loader for spaCy and Flan-T5 models.

Import `get_models()` anywhere; the heavy models are downloaded and loaded
only once, on first call.
"""

import spacy
from transformers import pipeline

_nlp = None
_generator = None


def get_models():
    """Return (nlp, generator) — loaded once and cached for the process lifetime."""
    global _nlp, _generator

    if _nlp is None:
        print("[model_loader] Loading spaCy en_core_web_sm …")
        _nlp = spacy.load("en_core_web_sm")
        print("[model_loader] spaCy loaded.")

    if _generator is None:
        print("[model_loader] Loading Flan-T5 (first run downloads ~990 MB) …")
        _generator = pipeline("text2text-generation", model="google/flan-t5-base")
        print("[model_loader] Flan-T5 loaded.")

    return _nlp, _generator
