"""
pdf_exporter.py — PDF generation for study analysis results using FPDF2.
"""

import re
from fpdf import FPDF


def export_to_pdf(data: dict, filename: str = "output.pdf") -> str:
    """
    Generate a formatted PDF from analysis data.

    Args:
        data: dict with keys: simplified, questions, keywords, difficulty
        filename: output file path

    Returns:
        The filename that was written.
    """
    pdf = FPDF()
    pdf.add_page()
    pdf.set_margins(15, 15, 15)
    pdf.set_auto_page_break(auto=True, margin=15)

    page_width = pdf.w - 30  # left + right margins

    def sanitize(text: str, max_word: int = 40) -> str:
        """Break long unbreakable words and ensure latin-1 compatibility."""
        text = re.sub(
            r"(\S{" + str(max_word) + r",})",
            lambda m: " ".join(
                m.group(0)[i : i + max_word]
                for i in range(0, len(m.group(0)), max_word)
            ),
            text,
        )
        return text.encode("latin-1", errors="replace").decode("latin-1")

    def write_heading(title: str):
        pdf.set_font("Arial", style="B", size=12)
        pdf.cell(page_width, 10, sanitize(title), ln=True, align="L")
        pdf.set_font("Arial", size=12)

    def write_body(text: str):
        try:
            pdf.multi_cell(page_width, 8, sanitize(text), align="L")
        except Exception:
            pass
        pdf.ln(2)

    # ── Title ─────────────────────────────────────────────
    pdf.set_font("Arial", style="B", size=14)
    pdf.cell(page_width, 12, "Smart Study Assistant Output", ln=True, align="C")
    pdf.ln(4)

    # ── Simplified Text ───────────────────────────────────
    write_heading("Simplified Text:")
    write_body(data.get("simplified", ""))
    pdf.ln(2)

    # ── Questions ─────────────────────────────────────────
    write_heading("Questions:")
    for q in data.get("questions", []):
        q = q.strip()
        if q:
            write_body(f"- {q}")
    pdf.ln(2)

    # ── Keywords ──────────────────────────────────────────
    write_heading("Keywords:")
    write_body(", ".join(data.get("keywords", [])))
    pdf.ln(2)

    # ── Difficulty ────────────────────────────────────────
    write_heading("Difficulty Level:")
    write_body(data.get("difficulty", ""))

    pdf.output(filename)
    return filename
