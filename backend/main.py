"""
main.py — FastAPI server for Smart Study Assistant.

Endpoints:
    POST   /analyze          → run all NLP tasks
    GET    /history          → list all past analyses
    DELETE /history/{index}  → remove one history entry
    POST   /export-pdf       → stream a PDF download
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List

from services.nlp_service import (
    analyze_text,
    get_history,
    delete_history_item,
    export_to_pdf,
)

app = FastAPI(title="Smart Study Assistant API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response models ─────────────────────────────────────────────────

class TextRequest(BaseModel):
    text: str


class ExportRequest(BaseModel):
    simplified: str = ""
    questions: List[str] = []
    keywords: List[str] = []
    difficulty: str = ""


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/analyze")
def analyze(req: TextRequest):
    return analyze_text(req.text)


@app.get("/history")
def history():
    return get_history()


@app.delete("/history/{index}")
def delete_history(index: int):
    success = delete_history_item(index)
    if not success:
        raise HTTPException(status_code=404, detail="Index out of range")
    return {"status": "deleted"}


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
