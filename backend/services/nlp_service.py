"""
nlp_service.py — Uses Claude API (claude-sonnet-4-20250514) instead of local
                 spaCy + Flan-T5 models. Runs on ~50 MB RAM — Render-friendly.
"""

import os
import json
import re
import anthropic

from services import history_manager

# ── Client — key comes from environment variable, never hardcoded ─────────────
_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

SYSTEM_PROMPT = """You are an AI study assistant. When given a passage of text,
you respond ONLY with a valid JSON object — no markdown, no explanation, no extra text.

The JSON must have exactly these keys:
{
  "simplified": "<the text rewritten in plain simple language a student can understand>",
  "questions": ["<question 1>", "<question 2>", "<question 3>", "<question 4>", "<question 5>"],
  "keywords": ["<keyword1>", "<keyword2>", ...],
  "difficulty": "<Easy|Medium|Hard>"
}

Rules:
- simplified: rewrite in clear, short sentences. Keep all key facts.
- questions: exactly 5 practice questions covering the main ideas.
- keywords: 5–15 important nouns or concepts from the text, lowercase, sorted.
- difficulty: Easy (< 12 avg words/sentence), Medium (12–19), Hard (20+).
- Output ONLY the JSON. Any other output breaks the parser."""


def analyze_text(text: str) -> dict:
    """Send text to Claude API and return structured analysis."""
    message = _client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"Analyze this text:\n\n{text}"}],
    )

    raw = message.content[0].text.strip()

    # Strip accidental markdown fences if model adds them
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    result = json.loads(raw)

    # Validate / normalise keys so downstream code never breaks
    result.setdefault("simplified", "")
    result.setdefault("questions", [])
    result.setdefault("keywords", [])
    result.setdefault("difficulty", "Medium")

    history_manager.save_history({"input": text, **result})
    return result


# ── Re-exports so main.py import surface stays unchanged ──────────────────────
get_history = history_manager.get_history
save_history = history_manager.save_history
delete_history_item = history_manager.delete_history_item
