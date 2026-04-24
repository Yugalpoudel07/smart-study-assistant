"""
question_generator.py — Practice question generation using Flan-T5.
"""

import re
from nltk.tokenize import sent_tokenize

_generator = None


def init(generator_pipeline):
    global _generator
    _generator = generator_pipeline


def generate_questions(text: str) -> list[str]:
    """Generate up to 5 unique practice questions from the text."""
    sentences = sent_tokenize(text)
    questions = []

    for sent in sentences:
        prompt = f"Generate questions based on this text: {sent}"
        result = _generator(
            prompt,
            max_new_tokens=200,
            num_beams=4,
            do_sample=False,
            early_stopping=True,
        )
        raw_output = result[0]["generated_text"]
        lines = re.split(r"\n|\?", raw_output)

        for line in lines:
            q = line.strip()
            if len(q) > 10:
                if not q.endswith("?"):
                    q += "?"
                questions.append(q)

    # Deduplicate while preserving order
    questions = list(dict.fromkeys(questions))
    return questions[:5] if questions else ["Could not generate questions. Try a longer paragraph."]
