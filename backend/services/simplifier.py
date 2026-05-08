"""
simplifier.py — Text simplification using Flan-T5 with spaCy fallback.

Key improvements over v1:
─────────────────────────
1. Better prompt — "Rewrite in simple words:" is the most reliable instruction
   for Flan-T5-base. It avoids the Q&A mode that produces "A:" / "B:" prefixes
   and the summarizer mode that produces "This text is about..." artifacts.

2. Chunk-based processing — instead of sentence-by-sentence (which loses context
   and makes Flan-T5 produce one-word or echo outputs), we group sentences into
   chunks of ~3 and simplify each chunk as a unit. This gives the model enough
   context to produce meaningful simplified prose.

3. Output sanitization — a post-processing pass strips known Flan-T5 artifacts:
   • "A:" / "B:" / "Q:" answer-mode prefixes
   • "This text is/focuses/explains/..." summarizer openers
   • Numeric artifacts like "30 sentences" or "1."
   • Duplication of the prompt itself in the output

4. Fallback — unchanged: rule-based connector splitting when model output is
   too short or too similar to the input.
"""

import re
from nltk.tokenize import sent_tokenize

_nlp = None
_generator = None

# How many sentences to group into one chunk for the model
_CHUNK_SIZE = 3


def init(nlp_model, generator_pipeline):
    global _nlp, _generator
    _nlp = nlp_model
    _generator = generator_pipeline


# ── Output sanitizer ─────────────────────────────────────────────────────────

# Patterns that indicate Flan-T5 went into Q&A or summarizer mode
_ARTIFACT_PATTERNS = [
    # Answer-mode prefixes: "A:", "B:", "A: ", "1.", "1) "
    re.compile(r"^\s*[A-D]\s*:\s*", re.IGNORECASE),
    re.compile(r"^\s*\d+[\.\)]\s*"),
    # Summarizer openers
    re.compile(r"^\s*This (text|passage|paragraph|article|section) (is|focuses|explains|describes|discusses|presents|aims|provides|covers|talks|states|argues|suggests|shows|highlights|examines)\b", re.IGNORECASE),
    re.compile(r"^\s*The (text|passage|paragraph|article|author) (is|focuses|explains|describes|discusses|presents|argues|suggests|states)\b", re.IGNORECASE),
    re.compile(r"^\s*A (student|reader|person|critical thinker)\b", re.IGNORECASE),
    # Number-of-sentences artifacts
    re.compile(r"^\s*\d+\s+sentences?\b", re.IGNORECASE),
    # Science/Tech label artifacts
    re.compile(r"^\s*Science\s*/\s*Tech\b", re.IGNORECASE),
    # "AI Analysis is ON" — panel UI text that leaked into selection
    re.compile(r"AI Analysis is (ON|OFF)", re.IGNORECASE),
]

def _sanitize(text: str) -> str:
    """
    Clean known Flan-T5 output artifacts from a simplified sentence/chunk.
    Returns the cleaned string, or empty string if the whole output is junk.
    """
    text = text.strip()

    # Strip answer-mode prefix from the start (may repeat: "A: B: real content")
    for _ in range(4):
        changed = False
        for pat in _ARTIFACT_PATTERNS[:2]:   # only prefix patterns in loop
            new = pat.sub("", text).strip()
            if new != text:
                text = new
                changed = True
        if not changed:
            break

    # If the whole sentence matches a summarizer/artifact pattern, discard it
    for pat in _ARTIFACT_PATTERNS[2:]:
        if pat.match(text):
            return ""

    # Discard if output is suspiciously short (model gave up)
    if len(text.split()) < 4:
        return ""

    return text


# ── Chunking ─────────────────────────────────────────────────────────────────

def _chunk_sentences(sentences: list[str], size: int) -> list[str]:
    """Group sentences into chunks of `size` for richer model context."""
    return [
        " ".join(sentences[i : i + size])
        for i in range(0, len(sentences), size)
    ]


# ── Core simplifier ───────────────────────────────────────────────────────────

def simplify_text(text: str) -> str:
    """
    Simplify text by grouping sentences into chunks and running each through
    Flan-T5 with a clean, unambiguous prompt.
    """
    # Pre-clean: remove any UI text that may have leaked into the selection
    text = re.sub(r"AI Analysis is (ON|OFF)[^.]*\.", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"\s{2,}", " ", text)

    sentences = sent_tokenize(text)
    if not sentences:
        return text

    chunks = _chunk_sentences(sentences, _CHUNK_SIZE)
    simplified_parts = []

    for chunk in chunks:
        # Prompt tuned for Flan-T5-base:
        # - "Rewrite in simple words:" reliably produces plain prose
        # - Avoids Q&A trigger words ("what", "explain", "generate") that
        #   cause "A:" prefix outputs
        # - Avoids "summarize" which causes "This text is about..." outputs
        prompt = f"Rewrite in simple words: {chunk}"

        result = _generator(
            prompt,
            max_new_tokens=300,
            num_beams=4,
            do_sample=False,
            early_stopping=True,
            no_repeat_ngram_size=3,   # reduces repetition loops
        )

        raw = result[0]["generated_text"].strip()
        cleaned = _sanitize(raw)

        if cleaned:
            simplified_parts.append(cleaned)
        else:
            # Fallback: rule-based simplification for this chunk
            simplified_parts.append(_fallback_simplify(chunk))

    result_text = " ".join(simplified_parts)

    # Final check: if the whole output still looks like junk, return fallback
    junk_ratio = sum(1 for p in _ARTIFACT_PATTERNS if p.search(result_text)) 
    if junk_ratio >= 2:
        return _fallback_simplify(text)

    return result_text


# ── Rule-based fallback ───────────────────────────────────────────────────────

def _fallback_simplify(text: str) -> str:
    """
    Rule-based simplification when the model output is unhelpful.
    Splits on discourse connectors and drops empty/connector-only fragments.
    """
    doc = _nlp(text)
    simple_sentences = []
    connectors = {"however", "therefore", "furthermore", "consequently", "nevertheless",
                  "additionally", "similarly", "moreover", "nonetheless"}

    for sent in doc.sents:
        parts = re.split(
            r"\b(however|therefore|furthermore|consequently|nevertheless|"
            r"additionally|similarly|moreover|nonetheless)\b",
            sent.text.strip(),
            flags=re.IGNORECASE,
        )
        for part in parts:
            part = part.strip()
            if len(part.split()) > 5 and part.lower() not in connectors:
                simple_sentences.append(part)

    return " ".join(simple_sentences) if simple_sentences else text
