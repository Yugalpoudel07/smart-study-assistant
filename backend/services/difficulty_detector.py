"""
difficulty_detector.py — Text difficulty classification based on sentence complexity.

Changes vs original:
  - BUG FIX (BUG 9): Added syllable counting (vowel-cluster proxy) and a
    simplified Flesch-Kincaid grade level computation alongside the original
    words-per-sentence metric.  Both metrics are combined to produce the
    Easy / Medium / Hard label.

Metrics used:
    1. avg_words_per_sentence — unchanged from original.
    2. avg_syllables_per_word — proxy: count vowel clusters (a e i o u y
       groups) per word.  This is a standard heuristic for syllable counting
       that avoids the need for a pronunciation dictionary.
    3. fk_grade — simplified Flesch-Kincaid Grade Level:
           0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59
       Standard FK thresholds:  < 6 → Easy,  6–10 → Medium,  > 10 → Hard.

Combined decision rule:
    A text is Hard if *either* metric puts it there.
    A text is Easy only if *both* metrics agree.
    Otherwise it is Medium.
"""

import re
from nltk.tokenize import sent_tokenize


# ── Syllable proxy ────────────────────────────────────────────────────────────

def _count_syllables(word: str) -> int:
    """
    Count syllables in a single word by counting vowel clusters.

    Examples:
        "cat"       → 1  (one vowel cluster: 'a')
        "simple"    → 2  ('i', 'e')
        "beautiful" → 3  ('eau', 'i', 'ul'… counted as 'eau'=1, 'i'=1, 'u'=1 → 3)

    Returns at least 1 for any non-empty word.
    """
    word = word.lower().strip()
    word = re.sub(r"[^a-z]", "", word)  # strip punctuation
    if not word:
        return 0
    clusters = re.findall(r"[aeiouy]+", word)
    return max(1, len(clusters))


# ── Main classifier ───────────────────────────────────────────────────────────

def detect_difficulty(text: str) -> str:
    """
    Classify text as Easy / Medium / Hard using a combination of:
      - average words per sentence
      - simplified Flesch-Kincaid grade level (syllable-based)
    """
    sentences = sent_tokenize(text)
    if not sentences:
        return "Easy"

    words_per_sent = [s.split() for s in sentences]
    total_words    = sum(len(w) for w in words_per_sent)
    num_sentences  = len(sentences)

    if total_words == 0:
        return "Easy"

    # ── Metric 1: average words per sentence ─────────────────────────────────
    avg_words = total_words / num_sentences

    if avg_words < 12:
        wps_level = "Easy"
    elif avg_words < 20:
        wps_level = "Medium"
    else:
        wps_level = "Hard"

    # ── Metric 2: simplified Flesch-Kincaid grade level ──────────────────────
    all_words      = [w for sent_words in words_per_sent for w in sent_words]
    total_syllables = sum(_count_syllables(w) for w in all_words)
    avg_syllables  = total_syllables / total_words

    fk_grade = (0.39 * avg_words) + (11.8 * avg_syllables) - 15.59

    if fk_grade < 6:
        fk_level = "Easy"
    elif fk_grade < 10:
        fk_level = "Medium"
    else:
        fk_level = "Hard"

    # ── Combine: Hard wins; Easy only if both agree; else Medium ─────────────
    if wps_level == "Hard" or fk_level == "Hard":
        return "Hard"
    if wps_level == "Easy" and fk_level == "Easy":
        return "Easy"
    return "Medium"
