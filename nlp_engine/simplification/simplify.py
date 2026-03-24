from transformers import pipeline

simplifier = pipeline("text2text-generation", model="t5-small")

def simplify_text(text: str):
    prompt = "simplify: " + text

    result = simplifier(
        prompt,
        max_new_tokens=100,
        num_beams=2
    )

    return result[0]['generated_text']