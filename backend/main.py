from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from services.nlp_service import analyze_text, get_history, export_to_pdf, save_history

import json
import os
from io import BytesIO
from fastapi.responses import StreamingResponse

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

HISTORY_FILE = "history.json"


class TextRequest(BaseModel):
    text: str


class ExportRequest(BaseModel):
    simplified: str = ""
    questions: List[str] = []
    keywords: List[str] = []
    difficulty: str = ""


@app.post("/analyze")
def analyze(req: TextRequest):
    result = analyze_text(req.text)
    return result


@app.get("/history")
def history():
    return get_history()


@app.delete("/history/{index}")
def delete_history(index: int):
    items = get_history()
    if 0 <= index < len(items):
        items.pop(index)
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(items, f, indent=2)
        return {"status": "deleted"}
    return {"status": "index out of range"}


@app.post("/export-pdf")
def export_pdf(req: ExportRequest):
    data = {
        "simplified": req.simplified,
        "questions": req.questions,
        "keywords": req.keywords,
        "difficulty": req.difficulty,
    }
    filename = export_to_pdf(data)
    return StreamingResponse(
        open(filename, "rb"),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=study_output.pdf"},
    )
