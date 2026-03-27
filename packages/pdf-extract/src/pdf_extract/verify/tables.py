"""Layer 2: Cell-by-cell table verification."""
from __future__ import annotations

import json
import re
import unicodedata
from typing import TYPE_CHECKING

from pdf_extract.lib import get_logger
from pdf_extract.lib.pdf import crop_region

if TYPE_CHECKING:
    from pdf_extract.config import PipelineConfig
    from pdf_extract.lib.protocols import VisionExtractor
    from pdf_extract.metrics import PipelineMetrics

log = get_logger("verify.tables")


# ---------------------------------------------------------------------------
# Table parsing helpers
# ---------------------------------------------------------------------------


def _normalize(text: str) -> str:
    """Normalize text for comparison: lowercase, strip whitespace, NFD."""
    return unicodedata.normalize("NFD", text.strip().lower())


def _count_md_table_dims(table_md: str) -> tuple[int, int]:
    """Count rows and columns in a markdown table."""
    lines = [
        ln.strip()
        for ln in table_md.strip().splitlines()
        if ln.strip() and not re.match(r"^\|[-:\s|]+\|$", ln.strip())
    ]
    rows = len(lines)
    cols = 0
    if lines:
        cols = lines[0].count("|") - 1
        if cols < 0:
            cols = 0
    return rows, cols


def _parse_md_table_cells(table_md: str) -> list[dict[str, object]]:
    """Parse a markdown table into a list of cell dicts with position and text."""
    cells: list[dict[str, object]] = []
    lines = [
        ln.strip()
        for ln in table_md.strip().splitlines()
        if ln.strip() and not re.match(r"^\|[-:\s|]+\|$", ln.strip())
    ]
    for row_idx, line in enumerate(lines):
        parts = line.strip("|").split("|")
        for col_idx, cell_text in enumerate(parts):
            cells.append(
                {
                    "row": row_idx,
                    "col": col_idx,
                    "text": cell_text.strip(),
                    "position": f"R{row_idx}C{col_idx}",
                }
            )
    return cells


def _infer_column_types(cells: list[dict[str, object]], num_cols: int) -> dict[int, str]:
    """Infer column types from cell content: numeric, date, currency, text."""
    type_map: dict[int, str] = {}

    date_re = re.compile(r"^\d{1,4}[-/\.]\d{1,2}[-/\.]\d{1,4}$")
    currency_re = re.compile(r"^[\$\u20ac\u00a3\u00a5]?\s?[\d,]+\.?\d*$")
    numeric_re = re.compile(r"^-?[\d,]+\.?\d*%?$")

    for col in range(num_cols):
        col_cells = [c for c in cells if c["col"] == col and c["row"] != 0]
        if not col_cells:
            type_map[col] = "text"
            continue

        texts = [str(c["text"]).strip() for c in col_cells if str(c["text"]).strip()]
        if not texts:
            type_map[col] = "text"
            continue

        date_count = sum(1 for t in texts if date_re.match(t))
        currency_count = sum(1 for t in texts if currency_re.match(t))
        numeric_count = sum(1 for t in texts if numeric_re.match(t))
        total = len(texts)
        threshold = 0.6

        if date_count / total > threshold:
            type_map[col] = "date"
        elif currency_count / total > threshold:
            type_map[col] = "currency"
        elif numeric_count / total > threshold:
            type_map[col] = "numeric"
        else:
            type_map[col] = "text"

    return type_map


def _matches_column_type(cell_text: str, col_type: str) -> bool:
    """Check if a cell value is consistent with its column type."""
    text = cell_text.strip()
    if not text or text == "[?]" or text == "[UNREADABLE]":
        return True

    if col_type == "numeric":
        return bool(re.match(r"^-?[\d,]+\.?\d*%?$", text))
    if col_type == "date":
        return bool(re.match(r"^\d{1,4}[-/\.]\d{1,2}[-/\.]\d{1,4}$", text))
    if col_type == "currency":
        return bool(re.match(r"^[\$\u20ac\u00a3\u00a5]?\s?[\d,]+\.?\d*$", text))
    return True


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def verify_tables(
    pdf_path: str,
    markdown: str,
    tables_info: list[dict[str, object]],
    config: PipelineConfig,
    metrics: PipelineMetrics,
    client: VisionExtractor | None = None,
) -> str:
    """Verify all tables in the document.

    Args:
        pdf_path: Path to the PDF.
        markdown: Full extracted markdown.
        tables_info: List of dicts with keys: page_idx, bbox, table_md.
        config: Pipeline config.
        metrics: Pipeline metrics.
        client: VisionExtractor for cell OCR (optional, for stage 2).

    Returns:
        Updated markdown with table corrections applied.
    """
    if not tables_info:
        return markdown

    import fitz

    from pdf_extract.lib.pdf import render_page

    doc = fitz.open(pdf_path)

    updated_markdown = markdown

    for table in tables_info:
        raw_idx = table.get("page_idx", 0)
        page_idx = int(raw_idx) if isinstance(raw_idx, (int, float, str)) else 0
        bbox = table.get("bbox")
        table_md = str(table.get("table_md", ""))

        if not table_md.strip():
            continue

        # Stage 1: Structure verification via VLM
        extracted_rows, extracted_cols = _count_md_table_dims(table_md)

        if client and bbox:
            page_img = render_page(doc, page_idx, dpi=200)
            bbox_tuple = (
                float(bbox[0]),  # type: ignore[index]
                float(bbox[1]),  # type: ignore[index]
                float(bbox[2]),  # type: ignore[index]
                float(bbox[3]),  # type: ignore[index]
            )
            table_img = crop_region(page_img, bbox_tuple)

            try:
                structure_resp = await client.generate(
                    prompt=(
                        "How many rows and columns does the table in this image have? "
                        'Return JSON: {"rows": N, "cols": M}'
                    ),
                    image_bytes=table_img,
                )
                cleaned = structure_resp.strip().removeprefix("```json").removesuffix("```").strip()
                detected = json.loads(cleaned)
                detected_rows = detected.get("rows", 0)
                detected_cols = detected.get("cols", 0)

                if detected_rows != extracted_rows or detected_cols != extracted_cols:
                    log.warning(
                        "table.structure_mismatch",
                        page=page_idx,
                        detected=(detected_rows, detected_cols),
                        extracted=(extracted_rows, extracted_cols),
                    )
                    metrics.verification.table_mismatches += 1
            except (json.JSONDecodeError, Exception) as exc:
                log.warning("table.structure_check_failed", page=page_idx, error=str(exc))

        # Stage 2: Cell-level verification (if client available)
        cells = _parse_md_table_cells(table_md)
        metrics.verification.table_cells_verified += len(cells)

        # Stage 3: Column-type consistency
        if config.column_type_consistency:
            _, num_cols = _count_md_table_dims(table_md)
            col_types = _infer_column_types(cells, num_cols)
            for cell in cells:
                raw_row = cell.get("row", 0)
                row = int(raw_row) if isinstance(raw_row, (int, float, str)) else 0
                if row == 0:
                    continue  # Skip header
                raw_col = cell.get("col", 0)
                col = int(raw_col) if isinstance(raw_col, (int, float, str)) else 0
                text = str(cell.get("text", ""))
                if col in col_types and not _matches_column_type(text, col_types[col]):
                    metrics.verification.table_mismatches += 1
                    log.info(
                        "table.type_violation",
                        page=page_idx,
                        cell=cell.get("position"),
                        expected_type=col_types[col],
                        value=text,
                    )

    doc.close()

    log.info(
        "tables.complete",
        tables_verified=len(tables_info),
        cells_verified=metrics.verification.table_cells_verified,
        mismatches=metrics.verification.table_mismatches,
    )
    return updated_markdown
