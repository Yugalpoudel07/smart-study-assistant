"""
question_generator.py — Practice question generation using Groq API
                         (llama-3.1-8b-instant, same model as simplifier.py).

WHY GROQ INSTEAD OF DEEPINFRA:
  - valhalla/t5-base-qg-hl and all other small seq2seq QG models are NOT
    hosted on DeepInfra — they only host large LLMs (Llama, Qwen, Mistral, etc.)
  - Groq is already in requirements.txt, already configured with GROQ_API_KEY,
    and already proven working for simplifier.py
  - Groq's llama-3.1-8b-instant is fast, free-tier friendly, and produces
    high-quality factual questions when given a structured prompt

STRATEGY:
  - For each sentence in the text, ask the model to generate one focused
    question whose answer lies in that sentence
  - Run all sentence prompts concurrently via ThreadPoolExecutor
  - Clean, deduplicate, and return up to MAX_QUESTIONS results

SETUP:
  Same key as simplifier — just ensure GROQ_API_KEY is in backend/.env
"""

import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from nltk.tokenize import sent_tokenize
from groq import Groq

# ── Config ────────────────────────────────────────────────────────────────────

MAX_QUESTIONS = 5
_MAX_WORKERS  = 4      # concurrent Groq calls
_GROQ_MODEL   = "llama-3.1-8b-instant"

# ── State ─────────────────────────────────────────────────────────────────────

_groq: Groq | None = None
_nlp               = None   # spaCy model (used for span extraction, optional)


def init(generator_pipeline=None, nlp_model=None):
    """
    Called by nlp_service.py on startup.
    generator_pipeline is accepted but ignored — kept for call-signature compat.
    """
    global _groq, _nlp
    _nlp = nlp_model

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError(
            "[question_generator] GROQ_API_KEY not set. "
            "Add GROQ_API_KEY=<your key> to backend/.env"
        )

    _groq = Groq(api_key=api_key)
    print(f"[question_generator] Groq client ready — model: {_GROQ_MODEL}")


# ── Sentence selection ────────────────────────────────────────────────────────

def _select_sentences(text: str) -> list[str]:
    """
    Return a filtered, deduplicated list of sentences suitable for QG.
    Skips sentences that are too short to yield a meaningful question.
    Caps at MAX_QUESTIONS * 3 to avoid unnecessary API calls.
    """
    sentences = sent_tokenize(text)
    selected  = []
    seen      = set()

    for sent in sentences:
        sent = sent.strip()
        # Must be long enough to contain a real fact
        if len(sent) < 30:
            continue
        # Skip near-duplicates
        key = sent.lower()[:60]
        if key in seen:
            continue
        seen.add(key)
        selected.append(sent)
        if len(selected) >= MAX_QUESTIONS * 3:
            break

    return selected


# ── Groq call ─────────────────────────────────────────────────────────────────

def _generate_question_for_sentence(sentence: str) -> str | None:
    """
    Ask Groq to generate one focused question whose answer is in the sentence.
    Returns a cleaned question string or None if the output is unusable.
    """
    if _groq is None:
        return None

    prompt = (
        "You are a question generator for students.\n"
        "Read the sentence below and write exactly ONE clear, specific question "
        "that a student should be able to answer using only that sentence.\n\n"
        "Rules:\n"
        "- The question must start with a question word (What, Who, Where, When, "
        "Why, How, Which) or an auxiliary verb (Is, Are, Was, Were, Does, Did).\n"
        "- The question must end with a question mark.\n"
        "- Output ONLY the question. No explanation, no preamble, no extra text.\n\n"
        f"Sentence: {sentence}"
    )

    try:
        response = _groq.chat.completions.create(
            model=_GROQ_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a precise question generation assistant. "
                        "Output only the question. Never add explanations or extra sentences."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            max_tokens=80,
            temperature=0.4,
        )
        raw = response.choices[0].message.content.strip()
        return _clean_and_validate(raw)

    except Exception as exc:
        print(f"[question_generator] Groq error for sentence: {exc}")
        return None


# ── Output cleaning + validation ──────────────────────────────────────────────

def _clean_and_validate(raw: str | None) -> str | None:
    """Normalise and validate a raw model output into a well-formed question."""
    if not raw:
        return None

    # Take only the first line in case the model output multiple lines
    raw = raw.strip().splitlines()[0].strip()

    # Strip common LLM preambles
    raw = re.sub(
        r"^(here is|here's|sure[,!]?|certainly[,!]?|question\s*:\s*)",
        "", raw, flags=re.I
    ).strip()

    # Must start with a recognised question word or auxiliary verb
    question_starts = re.compile(
        r"^(what|who|where|when|why|how|which|is|are|was|were|"
        r"do|does|did|has|have|had|can|could|will|would)",
        re.I,
    )
    if not question_starts.match(raw) and "?" not in raw:
        return None

    # Ensure it ends with a question mark
    if not raw.endswith("?"):
        raw += "?"

    # Filter out too-short or too-generic outputs
    generic = {
        "what is the main idea of this passage?",
        "what is the main idea?",
        "what is the context of this article?",
        "what is this about?",
    }
    if len(raw) < 15 or raw.lower() in generic:
        return None

    return raw


# ── Public entry point ────────────────────────────────────────────────────────

def generate_questions(text: str) -> list[str]:
    """
    Generate up to MAX_QUESTIONS unique practice questions from *text*.

    Steps:
      1. Split text into sentences and filter for usable ones.
      2. Dispatch one Groq call per sentence concurrently.
      3. Clean, deduplicate, and return up to MAX_QUESTIONS results.
    """
    sentences = _select_sentences(text)

    if not sentences:
        print("[question_generator] No usable sentences found — text too short.")
        return ["Could not generate questions. Try a longer paragraph."]

    print(f"[question_generator] Generating questions for {len(sentences)} sentence(s)…")

    results: dict[int, str | None] = {}

    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as executor:
        future_to_idx = {
            executor.submit(_generate_question_for_sentence, sent): idx
            for idx, sent in enumerate(sentences)
        }
        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            try:
                results[idx] = future.result()
            except Exception as exc:
                print(f"[question_generator] Worker exception: {exc}")
                results[idx] = None

    # Reassemble in original sentence order for deterministic output
    questions: list[str] = []
    seen_keys: set[str]  = set()

    for idx in range(len(sentences)):
        q = results.get(idx)
        if not q:
            continue
        key = q.lower().rstrip("?").strip()
        if key in seen_keys:
            continue
        seen_keys.add(key)
        questions.append(q)
        if len(questions) >= MAX_QUESTIONS:
            break

    if questions:
        print(f"[question_generator] Produced {len(questions)} question(s).")
        return questions

    print("[question_generator] All outputs were filtered out.")
    return ["Could not generate questions. Try a longer paragraph."]