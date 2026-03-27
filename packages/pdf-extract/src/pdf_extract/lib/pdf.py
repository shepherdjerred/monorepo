"""PyMuPDF helpers: page rendering, cropping, text extraction."""
from __future__ import annotations

import io
from typing import Any

import fitz
import structlog

log = structlog.get_logger(__name__)


def render_page(doc: Any, page_idx: int, dpi: int = 200) -> bytes:
    """Render a PDF page as PNG bytes at the given DPI."""
    page = doc[page_idx]
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat)
    return bytes(pix.tobytes("png"))


def crop_region(page_img: bytes, bbox: tuple[float, float, float, float]) -> bytes:
    """Crop a rectangular region from a PNG image.

    Args:
        page_img: PNG image bytes.
        bbox: (x0, y0, x1, y1) normalised to pixel coordinates.

    Returns:
        Cropped PNG bytes.
    """
    from PIL import Image

    img = Image.open(io.BytesIO(page_img))
    cropped = img.crop(bbox)
    buf = io.BytesIO()
    cropped.save(buf, format="PNG")
    return buf.getvalue()


def extract_text(doc: Any, page_idx: int) -> str:
    """Extract plain text from a PDF page via PyMuPDF."""
    page = doc[page_idx]
    return str(page.get_text("text"))


def count_pdf_pages(pdf_path: str) -> int:
    """Return the number of pages in a PDF."""
    with fitz.open(pdf_path) as doc:
        return len(doc)


def is_encrypted(pdf_path: str) -> bool:
    """Check whether a PDF file is encrypted."""
    with fitz.open(pdf_path) as doc:
        return bool(doc.is_encrypted)
