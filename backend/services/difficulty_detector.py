"""
difficulty_detector.py — Text difficulty classification based on sentence complexity.
"""

from nltk.tokenize import sent_tokenize


def detect_difficulty(text: str) -> str:
    """
    Classify text as Easy / Medium / Hard based on average words per sentence.

    Thresholds:
        < 12 words/sentence  → Easy
        12–19 words/sentence → Medium
        20+ words/sentence   → Hard
    """
    sentences = sent_tokenize(text)
    if not sentences:
        return "Easy"

    total_words = sum(len(s.split()) for s in sentences)
    avg_words = total_words / len(sentences)

    if avg_words < 12:
        return "Easy"
    elif avg_words < 20:
        return "Medium"
    else:
        return "Hard"
