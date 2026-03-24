from transformers import pipeline

qg_pipeline = pipeline("text2text-generation", model="valhalla/t5-base-qg-hl")

def generate_questions(text: str):
    prompt = "generate questions: " + text

    result = qg_pipeline(
        prompt,
        max_new_tokens=100,
        num_beams=2
    )

    questions = result[0]['generated_text'].split("?")
    questions = [q.strip() + "?" for q in questions if q.strip()]

    return questions[:5]