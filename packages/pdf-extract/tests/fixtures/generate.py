"""Programmatic PDF generation for tests using fpdf2."""
from __future__ import annotations

from pathlib import Path

from fpdf import FPDF


def generate_simple_text(path: Path) -> list[str]:
    """Generate a 2-page PDF with known text. Returns expected strings per page."""
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)

    expected: list[str] = []

    # Page 1
    pdf.add_page()
    pdf.set_font("Helvetica", size=12)
    text1 = "The quick brown fox jumps over the lazy dog."
    text2 = "Pack my box with five dozen liquor jugs."
    pdf.cell(0, 10, text1, new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 10, text2, new_x="LMARGIN", new_y="NEXT")
    expected.append(f"{text1}\n{text2}")

    # Page 2
    pdf.add_page()
    text3 = "How vexingly quick daft zebras jump."
    text4 = "The five boxing wizards jump quickly."
    pdf.cell(0, 10, text3, new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 10, text4, new_x="LMARGIN", new_y="NEXT")
    expected.append(f"{text3}\n{text4}")

    pdf.output(str(path))
    return expected


def generate_table_pdf(path: Path) -> list[list[str]]:
    """Generate a PDF with a known table. Returns expected cell values as rows."""
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=10)

    headers = ["Name", "Age", "City"]
    rows = [
        ["Alice", "30", "New York"],
        ["Bob", "25", "San Francisco"],
        ["Charlie", "35", "Chicago"],
    ]

    col_width = 50
    row_height = 10

    # Header row
    pdf.set_font("Helvetica", "B", 10)
    for header in headers:
        pdf.cell(col_width, row_height, header, border=1)
    pdf.ln()

    # Data rows
    pdf.set_font("Helvetica", size=10)
    for row in rows:
        for cell in row:
            pdf.cell(col_width, row_height, cell, border=1)
        pdf.ln()

    pdf.output(str(path))
    return [headers, *rows]


def generate_annotated_pdf(path: Path) -> None:
    """Generate a PDF with text suitable for annotation testing.

    Note: fpdf2 doesn't support annotations directly.
    We generate a simple PDF, then add annotations via PyMuPDF.
    """
    import fitz  # type: ignore[import-untyped]

    # First create base PDF with fpdf2
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=12)
    pdf.cell(0, 10, "This is a test document with annotations.", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 10, "Important text that should be highlighted.", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 10, "Another paragraph for testing.", new_x="LMARGIN", new_y="NEXT")

    base_path = str(path) + ".base"
    pdf.output(base_path)

    # Add annotations with PyMuPDF
    doc = fitz.open(base_path)
    page = doc[0]

    # Add a sticky note
    page.add_text_annot(
        fitz.Point(100, 50),
        "This is a sticky note comment",
    )

    # Add a highlight (find text to highlight)
    text_instances = page.search_for("Important text")
    if text_instances:
        highlight = page.add_highlight_annot(text_instances[0])
        highlight.set_info(content="Highlighted for review")
        highlight.update()

    doc.save(str(path))
    doc.close()

    # Clean up base file
    Path(base_path).unlink(missing_ok=True)


def generate_degraded_scan(path: Path) -> None:
    """Generate a degraded scan: render text to image, reduce quality, embed in PDF."""
    import fitz  # type: ignore[import-untyped]

    # Create a text PDF first
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=14)
    pdf.cell(0, 10, "This text should be readable after preprocessing.", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 10, "Second line of degraded scan test content.", new_x="LMARGIN", new_y="NEXT")

    base_path = str(path) + ".base"
    pdf.output(base_path)

    # Render to low-quality image and re-embed
    doc = fitz.open(base_path)
    page = doc[0]
    # Render at very low DPI to simulate degraded scan
    pix = page.get_pixmap(dpi=72)
    img_bytes = pix.tobytes("png")
    doc.close()

    # Create new PDF with just the image
    out_doc = fitz.open()
    out_page = out_doc.new_page(width=pix.width, height=pix.height)
    out_page.insert_image(out_page.rect, stream=img_bytes)
    out_doc.save(str(path))
    out_doc.close()

    Path(base_path).unlink(missing_ok=True)
