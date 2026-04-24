"""
history_manager.py — Persistent analysis history backed by a local JSON file.
"""

import json
import os

HISTORY_FILE = "history.json"


def _load() -> list:
    if not os.path.exists(HISTORY_FILE):
        return []
    with open(HISTORY_FILE, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except (json.JSONDecodeError, ValueError):
            return []


def _save(history: list) -> None:
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2, ensure_ascii=False)


def save_history(entry: dict) -> None:
    """Append a new analysis entry to the history file."""
    history = _load()
    history.append(entry)
    _save(history)


def get_history() -> list:
    """Return all history entries."""
    return _load()


def delete_history_item(index: int) -> bool:
    """
    Delete the history entry at the given index.

    Returns True on success, False if index is out of range.
    """
    history = _load()
    if 0 <= index < len(history):
        history.pop(index)
        _save(history)
        return True
    return False
