from collections import Counter
import re

def extract_keywords(text: str):
    words = re.findall(r'\w+', text.lower())
    common = Counter(words).most_common(5)
    return [word for word, _ in common]