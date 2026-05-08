"""
keyword_extractor.py — Weighted keyword extraction using spaCy.

Algorithm (replaces the old "all nouns" approach):
───────────────────────────────────────────────────
1. Candidate selection
   - Tokens that are NOUN or PROPN, not a stop word, length > 2
   - Named-entity spans (any label) are always candidates

2. Scoring  (higher = more important)
   Each candidate lemma gets a composite score:

   a) Term Frequency (TF) — how often the lemma appears in the text
      (normalized by total candidate count so long texts don't dominate)

   b) IDF proxy — log(total_sentences / sentences_containing_lemma)
      Words that appear in every sentence are too generic; rare ones score higher.

   c) Positional boost — words in the first sentence get ×1.3
      (topic sentences usually introduce key concepts)

   d) NER boost — ×1.5 if the token is inside a named-entity span
      (spaCy already did the hard work of finding important spans)

   e) Noun-chunk-head boost — ×1.2 if the token is the head of a noun chunk
      ("machine learning" → "learning" is the head and the real concept)

   f) Title-case boost — ×1.1 for title-cased words that are not sentence-start
      (often domain-specific proper nouns that spaCy's NER missed)

3. Per-sentence cap
   Sort candidates by score descending.
   Walk sentences; keep at most MAX_KW_PER_SENTENCE keywords per sentence,
   choosing the highest-scored ones from that sentence.
   This prevents one long sentence from monopolising the keyword list.

4. Global top-N
   After the per-sentence pass, sort survivors by score and return the
   top MAX_TOTAL keywords (default 12).

Exposed function
────────────────
    extract_keywords(text: str) -> list[str]
        Returns a list of keyword strings (original surface form, title-cased
        for readability) sorted by descending score.
"""

import math
from collections import defaultdict

_nlp = None

# ── Tuneable parameters ──────────────────────────────────────────────────────
MAX_KW_PER_SENTENCE = 2    # supervisor requirement: ≤ 2 per sentence
MAX_TOTAL           = 12   # hard cap on total keywords returned
MIN_WORD_LEN        = 3    # ignore very short tokens

# Noisy generic nouns that slip through the stop-word list
_GENERIC_NOUNS = {
    "thing", "things", "way", "ways", "kind", "kinds", "type", "types",
    "part", "parts", "case", "cases", "example", "examples", "point",
    "fact", "facts", "time", "times", "number", "numbers", "lot", "lots",
    "use", "uses", "need", "needs", "place", "places", "person", "people",
    "world", "day", "days", "year", "years", "bit", "bits", "form", "forms",
    "result", "results", "area", "areas", "aspect", "aspects", "sense",
}


def init(nlp_model):
    global _nlp
    _nlp = nlp_model


# ── Helpers ──────────────────────────────────────────────────────────────────

def _sentences(doc):
    """Return list of spaCy sentence spans."""
    return list(doc.sents)


def _ner_token_set(doc):
    """Return set of token indices that belong to any named-entity span."""
    ner_indices = set()
    for ent in doc.ents:
        for tok in ent:
            ner_indices.add(tok.i)
    return ner_indices


def _noun_chunk_head_set(doc):
    """Return set of token indices that are heads of noun chunks."""
    return {chunk.root.i for chunk in doc.noun_chunks}


def _is_title_cased_non_start(token, sentences):
    """True if token is title-cased AND not the first token in its sentence."""
    if not token.text[0].isupper():
        return False
    for sent in sentences:
        if token.i == sent.start:   # sentence-opening capitals don't count
            return False
    return True


# ── Core ─────────────────────────────────────────────────────────────────────

def extract_keywords(text: str) -> list[str]:
    """
    Return a ranked list of important keywords extracted from *text*.
    At most MAX_KW_PER_SENTENCE keywords come from any single sentence,
    and at most MAX_TOTAL keywords are returned overall.
    """
    if not text or not text.strip():
        return []

    doc       = _nlp(text)
    sentences = _sentences(doc)
    n_sents   = max(len(sentences), 1)

    ner_set         = _ner_token_set(doc)
    chunk_head_set  = _noun_chunk_head_set(doc)

    # ── 1. Collect candidates ────────────────────────────────────────────────
    # candidate: (token, lemma, sentence_index)
    candidates = []
    for s_idx, sent in enumerate(sentences):
        for token in sent:
            if (
                token.pos_ in {"NOUN", "PROPN"}
                and not token.is_stop
                and len(token.text) > MIN_WORD_LEN
                and token.lemma_.lower() not in _GENERIC_NOUNS
                and token.text.isalpha()          # skip numbers / symbols
            ):
                candidates.append((token, token.lemma_.lower(), s_idx))

    if not candidates:
        return []

    # ── 2. Compute TF ────────────────────────────────────────────────────────
    lemma_tf: dict[str, int] = defaultdict(int)
    for _, lemma, _ in candidates:
        lemma_tf[lemma] += 1
    total_candidates = max(sum(lemma_tf.values()), 1)

    # ── 3. Compute IDF proxy ─────────────────────────────────────────────────
    # sentences_with_lemma[lemma] = number of sentences containing the lemma
    sentences_with_lemma: dict[str, set] = defaultdict(set)
    for _, lemma, s_idx in candidates:
        sentences_with_lemma[lemma].add(s_idx)

    def idf(lemma: str) -> float:
        df = len(sentences_with_lemma[lemma])
        return math.log((n_sents + 1) / (df + 1)) + 1.0   # smoothed, always ≥ 1

    # ── 4. Score every candidate token ───────────────────────────────────────
    # lemma → best (score, surface_form, sentence_index)
    lemma_best: dict[str, tuple[float, str, int]] = {}

    for token, lemma, s_idx in candidates:
        tf_score   = lemma_tf[lemma] / total_candidates
        idf_score  = idf(lemma)
        base_score = tf_score * idf_score

        # Boosts (multiplicative)
        boost = 1.0
        if token.i in ner_set:                              # named entity
            boost *= 1.5
        if token.i in chunk_head_set:                       # noun-chunk head
            boost *= 1.2
        if _is_title_cased_non_start(token, sentences):     # title-cased
            boost *= 1.1
        if s_idx == 0:                                      # first sentence
            boost *= 1.3

        score = base_score * boost

        # Keep the highest-scored occurrence of each lemma
        if lemma not in lemma_best or score > lemma_best[lemma][0]:
            lemma_best[lemma] = (score, token.text, s_idx)

    # ── 5. Per-sentence cap ──────────────────────────────────────────────────
    # Sort all surviving lemmas by score descending, then greedily pick
    # up to MAX_KW_PER_SENTENCE per sentence.
    ranked = sorted(lemma_best.values(), key=lambda x: x[0], reverse=True)

    sentence_kw_count: dict[int, int] = defaultdict(int)
    selected: list[tuple[float, str]] = []   # (score, surface_form)

    for score, surface, s_idx in ranked:
        if sentence_kw_count[s_idx] < MAX_KW_PER_SENTENCE:
            selected.append((score, surface))
            sentence_kw_count[s_idx] += 1
        if len(selected) >= MAX_TOTAL:
            break

    # ── 6. Return top-N sorted by score ─────────────────────────────────────
    selected.sort(key=lambda x: x[0], reverse=True)
    return [surface.lower() for _, surface in selected[:MAX_TOTAL]]
