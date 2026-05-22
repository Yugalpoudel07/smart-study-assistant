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

# Read once at startup so every request avoids repeated os.environ lookups.
_HISTORY_DISABLED = os.environ.get("DISABLE_HISTORY", "").lower() in ("1", "true", "yes")

if _HISTORY_DISABLED:
    print("[main] DISABLE_HISTORY=true — /history routes will return empty/ok responses")

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
    # DISABLE_HISTORY guard: history is now browser-side (content.js v3.3+).
    # Old extension versions that still call GET /history get an empty list
    # rather than an error, so they degrade gracefully.
    if _HISTORY_DISABLED:
        return []
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

    # DISABLE_HISTORY guard: history is now browser-side (content.js v3.3+).
    # Old extension versions that still call DELETE /history/{id} get a
    # success response instead of a 404, so they don't show an error to users.
    if _HISTORY_DISABLED:
        return {"status": "deleted"}

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