"""
history_manager.py — Persistent analysis history backed by a local JSON file.

Changes vs original:
  - BUG FIX: HISTORY_FILE now uses pathlib so the path is always relative to
    this file, not the CWD.  Fixes "history.json not found" when uvicorn is
    launched from a different directory.
  - BUG FIX: threading.Lock() guards all read-write operations so concurrent
    requests can't corrupt the file.
  - BUG FIX: Saves are now atomic — we write to history.tmp first, then
    os.replace() so a crash mid-write never produces a truncated JSON file.
  - BUG FIX (BUG 10): Each entry now gets a "id": str(uuid.uuid4()) on save.
    delete_history_item() now accepts a string UUID, not an integer index.
  - RENDER FIX: If the environment variable DISABLE_HISTORY=true is set,
    save_history() and delete_history_item() become no-ops and get_history()
    returns an empty list.  Use this on Render (ephemeral filesystem) to
    prevent crashes from disk-write failures.
"""

import json
import os
import threading
import uuid
from pathlib import Path

# Always resolve relative to *this file* so uvicorn's CWD doesn't matter.
HISTORY_FILE = Path(__file__).parent.parent / "history.json"
HISTORY_TMP  = Path(__file__).parent.parent / "history.tmp"

_lock = threading.Lock()

# ── Ephemeral-filesystem guard ────────────────────────────────────────────────
# Set DISABLE_HISTORY=true in your Render environment variables to skip all
# disk I/O.  get_history() returns [], saves and deletes are silent no-ops.
_HISTORY_DISABLED = os.environ.get("DISABLE_HISTORY", "").lower() in ("1", "true", "yes")

if _HISTORY_DISABLED:
    print("[history_manager] DISABLE_HISTORY=true — history persistence is OFF (ephemeral mode)")


def _load() -> list:
    """Load history from disk.  Must be called while holding _lock."""
    if not HISTORY_FILE.exists():
        return []
    with open(HISTORY_FILE, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except (json.JSONDecodeError, ValueError):
            return []


def _save(history: list) -> None:
    """Atomically write history to disk.  Must be called while holding _lock."""
    with open(HISTORY_TMP, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2, ensure_ascii=False)
    # os.replace is atomic on POSIX and Windows (same filesystem)
    os.replace(HISTORY_TMP, HISTORY_FILE)


def save_history(entry: dict) -> None:
    """Append a new analysis entry to the history file.

    Automatically assigns a UUID to the entry if one is not already present.
    No-op when DISABLE_HISTORY=true.
    """
    if _HISTORY_DISABLED:
        return  # silent no-op on ephemeral filesystems (e.g. Render free tier)

    with _lock:
        history = _load()
        # Assign a UUID so the frontend can reference entries without
        # worrying about array indices shifting after a delete.
        if "id" not in entry:
            entry["id"] = str(uuid.uuid4())
        history.append(entry)
        _save(history)


def get_history() -> list:
    """Return all history entries (thread-safe).
    
    Returns an empty list when DISABLE_HISTORY=true.
    """
    if _HISTORY_DISABLED:
        return []  # nothing persisted, nothing to return

    with _lock:
        return _load()


def delete_history_item(item_id: str) -> bool:
    """
    Delete the history entry with the given UUID string.

    Returns True on success, False if no entry with that id exists.
    Always returns False when DISABLE_HISTORY=true (nothing is stored).
    """
    if _HISTORY_DISABLED:
        return False  # nothing stored, so nothing can be deleted

    with _lock:
        history = _load()
        new_history = [entry for entry in history if entry.get("id") != item_id]
        if len(new_history) == len(history):
            # Nothing was removed — id not found
            return False
        _save(new_history)
        return True