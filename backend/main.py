"""
main.py — FastAPI server for Smart Study Assistant (Claude API backend).
Designed to run on Render free tier (~512 MB RAM).
"""

import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List

from services.nlp_service import (
    analyze_text,
    get_history,
    delete_history_item,
)
from services.pdf_exporter import export_to_pdf

app = FastAPI(title="Smart Study Assistant API", version="4.0")

# ── CORS — allow the extension (chrome-extension://) and any origin ───────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request models ────────────────────────────────────────────────────────────

class TextRequest(BaseModel):
    text: str


class ExportRequest(BaseModel):
    simplified: str = ""
    questions: List[str] = []
    keywords: List[str] = []
    difficulty: str = ""


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """Render health check — keeps the service alive."""
    return {"status": "ok", "version": "4.0"}


@app.post("/analyze")
def analyze(req: TextRequest):
    if not req.text or len(req.text.strip()) < 10:
        raise HTTPException(status_code=400, detail="Text too short (min 10 chars)")
    try:
        return analyze_text(req.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    try:
        filename = export_to_pdf(data)
        return StreamingResponse(
            open(filename, "rb"),
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=study_output.pdf"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
