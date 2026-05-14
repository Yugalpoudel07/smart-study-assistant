"""
simplifier.py — Text simplification using Flan-T5 prompt architecture
                 executed via Groq API (fast inference), with spaCy fallback.

Academic description:
    The simplification pipeline follows the Flan-T5 instruction-tuning paradigm:
    task-specific prompts, sentence-level routing, overlap-based quality guards,
    and rule-based fallback. Inference is offloaded to Groq for deployment
    efficiency while preserving the full algorithmic structure.

Routing strategy (Flan-T5 inspired):
    <= 5 sentences → sentence-by-sentence processing (fine-grained control)
    >  5 sentences → whole-text single-pass (context-aware for longer input)

Changes vs original:
  - BUG FIX (BUG 8): init() now checks for GROQ_API_KEY at startup and raises
    a clear RuntimeError if it is missing, rather than letting requests fail
    silently at inference time.
"""

import os
import re
from groq import Groq
from nltk.tokenize import sent_tokenize

# ── Injected by nlp_service (spaCy model for fallback) ───────────────────────
_nlp  = None
_groq = None   # Groq client

# Groq model — llama3-8b is fast and free-tier friendly
# _GROQ_MODEL = "llama3-8b-8192" # outdated calling way
_GROQ_MODEL = "llama-3.1-8b-instant" # latest calling way


def init(nlp_model, _generator_unused=None):
    """
    Called by nlp_service.py on startup.
    _generator_unused keeps the call signature compatible — Flan-T5 generator
    is still passed in (used by question_generator), we just don't need it here.

    BUG FIX (BUG 8): Raises RuntimeError immediately if GROQ_API_KEY is unset
    so the developer sees a clear message at startup instead of a cryptic
    authentication error on the first request.
    """
    global _nlp, _groq
    _nlp = nlp_model

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY not set. Add it to backend/.env"
        )

    _groq = Groq(api_key=api_key)
    print("[simplifier] Groq client ready — using model:", _GROQ_MODEL)


# ── Public entry point ────────────────────────────────────────────────────────

def simplify_text(text: str) -> str:
    """
    Simplify *text* using Flan-T5 prompt engineering executed on Groq.

    Routing (mirrors Flan-T5 instruction-tuning approach):
        <= 5 sentences → sentence-by-sentence mode
        >  5 sentences → whole-text mode
    """
    sentences      = sent_tokenize(text)
    sentence_count = len(sentences)

    if sentence_count <= 5:
        return _simplify_sentence_by_sentence(sentences)
    else:
        return _simplify_whole_text(text)


# ── Mode A: sentence-by-sentence (Flan-T5 style, <= 5 sentences) ─────────────

def _simplify_sentence_by_sentence(sentences: list) -> str:
    """
    Process each sentence independently — mirrors Flan-T5's token-window
    behaviour where short inputs are handled one at a time.
    """
    simplified_sentences = []

    for sent in sentences:
        # Flan-T5 style instruction prompt
        prompt = (
            "Simplify this sentence for a student in plain English. "
            "Use simple words. Keep the same meaning. "
            "Output only the simplified sentence, nothing else.\n\n"
            f"Sentence: {sent}"
        )
        result = _run_groq(prompt=prompt, original=sent)
        simplified_sentences.append(result)

    return " ".join(simplified_sentences)


# ── Mode B: whole-text single pass (> 5 sentences) ───────────────────────────

def _simplify_whole_text(text: str) -> str:
    """
    Single-pass simplification for longer texts — better context retention
    than per-sentence processing for multi-paragraph inputs.
    """
    prompt = (
        "You are a text simplification engine trained to rewrite academic and "
        "complex passages into plain English suitable for students.\n\n"
        "Instructions:\n"
        "- Use simple vocabulary and short sentences\n"
        "- Keep every main idea from the original\n"
        "- Do not add new information\n"
        "- Do not include explanations or preamble — output only the simplified text\n\n"
        f"Passage to simplify:\n{text}"
    )
    return _run_groq(prompt=prompt, original=text, max_tokens=1024)


# ── Groq inference (replaces local _generator() call) ────────────────────────

def _run_groq(prompt: str, original: str, max_tokens: int = 300) -> str:
    """
    Execute the prompt on Groq and apply the same quality guards
    originally designed for Flan-T5 output validation:
      - Too-short output guard
      - Echo/repetition guard (>85% word overlap → fallback)

    Falls back to spaCy rule-based simplification on failure.
    """
    try:
        response = _groq.chat.completions.create(
            model=_GROQ_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a precise text simplification assistant. "
                        "Always output only the simplified text. "
                        "Never add phrases like 'Here is the simplified version' or 'Sure!'. "
                        "Never repeat the original text verbatim."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            max_tokens=max_tokens,
            temperature=0.3,   # low temperature = consistent, focused output
        )

        simplified = response.choices[0].message.content.strip()

        # ── Quality guard 1: output too short ─────────────────────────────────
        if not simplified or len(simplified) < 10:
            print("[simplifier] Guard 1 triggered — output too short, using fallback")
            return _fallback_simplify(original)

        # ── Quality guard 2: model echoed the input (Flan-T5 overlap check) ──
        original_words = set(original.lower().split())
        output_words   = set(simplified.lower().split())
        overlap = len(original_words & output_words) / max(len(original_words), 1)
        if overlap > 0.85:
            print(f"[simplifier] Guard 2 triggered — {overlap:.0%} overlap, using fallback")
            return _fallback_simplify(original)

        # ── Post-processing: strip common LLM preamble artifacts ──────────────
        simplified = _strip_preamble(simplified)

        return simplified

    except Exception as e:
        print(f"[simplifier] Groq error: {e} — using fallback")
        return _fallback_simplify(original)


def _strip_preamble(text: str) -> str:
    """
    Remove common LLM response preambles that slip through despite the system prompt.
    e.g. "Here is the simplified version:" / "Sure! Here's a simplified version:"
    """
    preamble_patterns = [
        r"^(here is|here's|sure[,!]?|certainly[,!]?|of course[,!]?).*?:\s*",
        r"^simplified (text|version|passage)\s*[:\-]\s*",
    ]
    for pattern in preamble_patterns:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE).strip()
    return text


# ── Rule-based fallback (original Flan-T5 fallback — unchanged) ───────────────

def _fallback_simplify(text: str) -> str:
    """
    spaCy rule-based simplification — identical to the original Flan-T5 fallback.
    Splits on discourse connectors and returns the substantive clause parts.
    """
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
