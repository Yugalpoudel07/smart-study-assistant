"""
simplifier.py — Text simplification using Flan-T5 with spaCy fallback.
"""

import re
import spacy
from nltk.tokenize import sent_tokenize

# Loaded externally and injected to avoid circular import / duplicate load
_nlp = None
_generator = None


def init(nlp_model, generator_pipeline):
    global _nlp, _generator
    _nlp = nlp_model
    _generator = generator_pipeline


def simplify_text(text: str) -> str:
    """Simplify text sentence-by-sentence using Flan-T5."""
    sentences = sent_tokenize(text)
    simplified_sentences = []

    for sent in sentences:
        prompt = f"Simplify this text for a student: {sent}"
        result = _generator(
            prompt,
            max_new_tokens=250,
            num_beams=4,
            do_sample=False,
            early_stopping=True,
        )
        simplified = result[0]["generated_text"].strip()

        # Fallback: output too short
        if not simplified or len(simplified) < 10:
            simplified = _fallback_simplify(sent)
        else:
            # Fallback: model just echoed the input
            original_words = set(sent.lower().split())
            output_words = set(simplified.lower().split())
            overlap = len(original_words & output_words) / max(len(original_words), 1)
            if overlap > 0.85:
                simplified = _fallback_simplify(sent)

        simplified_sentences.append(simplified)

    return " ".join(simplified_sentences)


def _fallback_simplify(text: str) -> str:
    """Rule-based simplification when the model output is unhelpful."""
    doc = _nlp(text)
    simple_sentences = []
    connectors = {"however", "therefore", "furthermore", "consequently", "nevertheless"}

    for sent in doc.sents:
        parts = re.split(
            r"\b(however|therefore|furthermore|consequently|nevertheless)\b",
            sent.text.strip(),
            flags=re.IGNORECASE,
        )
        for part in parts:
            part = part.strip()
            if len(part.split()) > 5 and part.lower() not in connectors:
                simple_sentences.append(part)

    return " ".join(simple_sentences) if simple_sentences else text
