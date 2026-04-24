"""
keyword_extractor.py — Keyword extraction using spaCy POS tagging.
"""

_nlp = None


def init(nlp_model):
    global _nlp
    _nlp = nlp_model


def extract_keywords(text: str) -> list[str]:
    """Extract unique meaningful nouns and proper nouns from text."""
    doc = _nlp(text)
    keywords = set()

    for token in doc:
        if (
            token.pos_ in {"NOUN", "PROPN"}
            and not token.is_stop
            and len(token.text) > 2
        ):
            keywords.add(token.text.lower())

    return sorted(keywords)  # sorted for deterministic output
