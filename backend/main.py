"""
main.py — FastAPI server for Smart Study Assistant.

Endpoints:
    POST   /analyze        → run all NLP tasks
    GET    /history        → list all past analyses
    DELETE /history/{id}   → remove one history entry by UUID string
    POST   /export-pdf     → stream a PDF download

CORS FIX: allow_origins=["*"] with allow_credentials=False is the correct
  approach for a Chrome extension talking to localhost.

TRAILING SLASH FIX (redirect_slashes=False):
  FastAPI defaults to redirect_slashes=True, which means a request to
  DELETE /history/ (with trailing slash) gets a 307 Temporary Redirect
  to /history, which then returns 405 because DELETE /history is not a
  defined route.

  Root cause in the frontend: old history entries saved before the UUID
  fix have no "id" field, so item.id is undefined → encodeURIComponent("")
  → URL becomes /history/ (trailing slash) → 307 → 405.

  Two-part fix:
    1. redirect_slashes=False here — a malformed URL gets 404 immediately
       instead of silently redirecting to the wrong endpoint.
    2. Guard in the DELETE handler rejects empty item_id with 400.
    3. Frontend fix in content.js skips delete if itemId is empty.
"""

import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, BackgroundTasks
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

# redirect_slashes=False: never silently redirect a malformed URL.
# A DELETE /history/ (trailing slash, caused by empty UUID) now returns 404
# immediately rather than 307 → /history → 405.
app = FastAPI(
    title="Smart Study Assistant API",
    version="2.4",
    redirect_slashes=False,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
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


@app.delete("/history/{item_id}")
def delete_history(item_id: str):
    # Guard: reject empty or whitespace-only IDs immediately.
    # An empty item_id means the frontend sent /history/ (trailing slash),
    # which happens when an old history entry has no "id" field.
    if not item_id or not item_id.strip():
        raise HTTPException(
            status_code=400,
            detail="item_id is required and must be a non-empty UUID string."
        )

    success = delete_history_item(item_id)
    if not success:
        raise HTTPException(status_code=404, detail="History entry not found")
    return {"status": "deleted"}


# BackgroundTasks deletes the temp PDF after streaming completes (no file leak)
@app.post("/export-pdf")
def export_pdf(req: ExportRequest, background_tasks: BackgroundTasks):
    data = {
        "simplified": req.simplified,
        "questions":  req.questions,
        "keywords":   req.keywords,
        "difficulty": req.difficulty,
    }
    tmp_path = export_to_pdf(data)

    def _cleanup():
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    background_tasks.add_task(_cleanup)

    return StreamingResponse(
        open(tmp_path, "rb"),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=study_output.pdf"},
        background=background_tasks,
    )