"""
simplifier.py — Text simplification using Flan-T5 with spaCy fallback.

Strategy:
  - Count sentences in the input text.
  - If sentences <= 5  → sentence-by-sentence simplification (original behaviour).
  - If sentences >  5  → whole-text simplification in a single Flan-T5 pass.
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


# ── Public entry point ────────────────────────────────────────────────────────

def simplify_text(text: str) -> str:
    """
    Simplify *text* using Flan-T5.

    Routing logic
    -------------
    * <= 5 sentences → sentence-by-sentence mode (fine-grained, slower).
    * >  5 sentences → whole-text mode (single model call, faster for long input).
    """
    sentences = sent_tokenize(text)
    sentence_count = len(sentences)

    if sentence_count <= 5:
        return _simplify_sentence_by_sentence(sentences)
    else:
        return _simplify_whole_text(text)


# ── Mode A: sentence-by-sentence (original behaviour, <= 5 sentences) ─────────

def _simplify_sentence_by_sentence(sentences: list[str]) -> str:
    """Run Flan-T5 independently on every sentence and join the results."""
    simplified_sentences = []

    for sent in sentences:
        simplified = _run_model(
            prompt=f"Simplify this text for a student: {sent}",
            original=sent,
        )
        simplified_sentences.append(simplified)

    return " ".join(simplified_sentences)


# ── Mode B: whole-text (single pass, > 5 sentences) ──────────────────────────

def _simplify_whole_text(text: str) -> str:
    """
    Feed the entire text to Flan-T5 in one shot.

    The prompt instructs the model to preserve meaning while using simpler
    vocabulary and shorter sentences, which works better than per-sentence
    processing for longer passages where context matters.
    """
    prompt = (
        "Simplify the following passage for a student. "
        "Use simple words and short sentences. "
        "Keep all the main ideas:\n\n"
        f"{text}"
    )

    simplified = _run_model(
        prompt=prompt,
        original=text,
        # Allow more tokens for longer input
        max_new_tokens=512,
    )
    return simplified


# ── Shared model runner ───────────────────────────────────────────────────────

def _run_model(
    prompt: str,
    original: str,
    max_new_tokens: int = 250,
) -> str:
    """
    Call the Flan-T5 pipeline and apply quality guards.

    Falls back to rule-based simplification when:
      - The output is too short (< 10 characters).
      - The model merely echoed the input (> 85 % word overlap).
    """
    result = _generator(
        prompt,
        max_new_tokens=max_new_tokens,
        num_beams=4,
        do_sample=False,
        early_stopping=True,
    )
    simplified = result[0]["generated_text"].strip()

    # Guard 1: output too short
    if not simplified or len(simplified) < 10:
        return _fallback_simplify(original)

    # Guard 2: model echoed the input
    original_words = set(original.lower().split())
    output_words = set(simplified.lower().split())
    overlap = len(original_words & output_words) / max(len(original_words), 1)
    if overlap > 0.85:
        return _fallback_simplify(original)

    return simplified


# ── Rule-based fallback ───────────────────────────────────────────────────────

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