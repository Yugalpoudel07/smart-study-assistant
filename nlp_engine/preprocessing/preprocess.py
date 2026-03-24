import re

def clean_text(text: str) -> str:
    # remove extra spaces and newlines
    text = re.sub(r'\s+', ' ', text).strip()
    return text