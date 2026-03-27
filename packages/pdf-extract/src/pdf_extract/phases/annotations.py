"""Phase 3: Inline annotation extraction via PyMuPDF."""
from __future__ import annotations

import base64

import fitz  # type: ignore[import-untyped]

from pdf_extract.lib import get_logger

log = get_logger("phases.annotations")

# Annotation type constants (PDF spec)
_STICKY_NOTE = 0
_FREE_TEXT = 2
_SQUARE = 4
_CIRCLE = 5
_HIGHLIGHT = 8
_STRIKEOUT = 9
_SQUIGGLY = 10
_INK = 15

_KNOWN_TYPES = {_STICKY_NOTE, _FREE_TEXT, _SQUARE, _CIRCLE, _HIGHLIGHT, _STRIKEOUT, _SQUIGGLY, _INK}


def extract_annotations(pdf_path: str) -> tuple[str, int]:
    """Extract all annotations from a PDF, formatted as inline markdown.

    Returns:
        Tuple of (markdown_text, annotation_count).
    """
    log.info("annotations.start", pdf=pdf_path)
    parts: list[str] = []
    total_count = 0

    with fitz.open(pdf_path) as doc:
        for page_idx in range(len(doc)):
            page = doc[page_idx]
            annots = list(page.annots() or [])
            if not annots:
                continue

            # Sort by vertical position for inline placement
            annots.sort(key=lambda a: a.rect.y0)

            page_parts: list[str] = []
            for annot in annots:
                rendered = _render_annotation(page, annot)
                if rendered:
                    page_parts.append(rendered)
                    total_count += 1

            if page_parts:
                parts.append(f"\n<!-- Annotations: Page {page_idx + 1} -->\n")
                parts.extend(page_parts)

    markdown = "\n".join(parts)
    log.info("annotations.complete", count=total_count)
    return markdown, total_count


def _render_annotation(page: fitz.Page, annot: fitz.Annot) -> str | None:
    """Render a single annotation as markdown text."""
    annot_type = annot.type[0]
    content = (annot.info.get("content") or "").strip()

    if annot_type == _HIGHLIGHT:
        return _render_highlight(page, annot, content)
    if annot_type == _STRIKEOUT:
        highlighted = _extract_quad_text(page, annot)
        text = f"~~{highlighted}~~" if highlighted else "[Strikeout]"
        if content:
            text += f" — *{content}*"
        return f"> [Strikeout] {text}\n"
    if annot_type == _SQUIGGLY:
        highlighted = _extract_quad_text(page, annot)
        text = highlighted or "[Squiggly underline]"
        if content:
            text += f" — *{content}*"
        return f"> [Squiggly] {text}\n"
    if annot_type == _STICKY_NOTE:
        if not content:
            return None
        return f"> [Note] {content}\n"
    if annot_type == _FREE_TEXT:
        if not content:
            return None
        return f"> [Text] {content}\n"
    if annot_type in (_SQUARE, _CIRCLE):
        shape = "Square" if annot_type == _SQUARE else "Circle"
        if content:
            return f"> [{shape}] {content}\n"
        return f"> [{shape} annotation]\n"
    if annot_type == _INK:
        return _render_ink(page, annot)

    log.warning("annotations.unknown_type", annot_type=annot_type, page=page.number)
    return None


def _render_highlight(page: fitz.Page, annot: fitz.Annot, content: str) -> str:
    """Render a highlight annotation using quad points for multi-line accuracy."""
    highlighted = _extract_quad_text(page, annot)
    text = f"=={highlighted}==" if highlighted else "[Highlight]"
    if content:
        text += f" — *{content}*"
    return f"> [Highlight] {text}\n"


def _extract_quad_text(page: fitz.Page, annot: fitz.Annot) -> str:
    """Extract text under annotation using quad points for multi-line accuracy."""
    vertices = annot.vertices
    if not vertices or len(vertices) < 4:
        # Fallback to rect-based extraction
        return str(page.get_text("text", clip=annot.rect)).strip()

    texts: list[str] = []
    for i in range(0, len(vertices), 4):
        quad_points = vertices[i : i + 4]
        if len(quad_points) < 4:
            break
        quad = fitz.Quad(quad_points)
        text = str(page.get_text("text", clip=quad.rect)).strip()
        if text:
            texts.append(text)

    return " ".join(texts) if texts else str(page.get_text("text", clip=annot.rect)).strip()


def _render_ink(page: fitz.Page, annot: fitz.Annot) -> str:
    """Render a freehand/ink annotation by capturing its region as an image."""
    rect = annot.rect
    clip = fitz.Rect(rect)
    pix = page.get_pixmap(clip=clip, dpi=200)
    png_bytes = pix.tobytes("png")
    b64 = base64.b64encode(png_bytes).decode()
    return f"> [Freehand] ![ink annotation](data:image/png;base64,{b64})\n"
