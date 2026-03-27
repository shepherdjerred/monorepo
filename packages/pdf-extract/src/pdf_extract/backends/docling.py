"""Docling extraction backend: CLI wrapper for docling PDF→Markdown."""
from __future__ import annotations

import asyncio
import shutil
from pathlib import Path
from typing import TYPE_CHECKING

from pdf_extract.lib import get_logger

if TYPE_CHECKING:
    from pdf_extract.config import PipelineConfig

log = get_logger("backends.docling")


class ExtractionError(Exception):
    """Raised when the extraction backend fails."""


async def extract_with_docling(
    pdf_path: str,
    output_dir: str,
    config: PipelineConfig,
) -> tuple[str, list[Path], list[dict[str, object]]]:
    """Extract PDF content using the docling CLI.

    Returns:
        Tuple of (markdown_text, image_paths, table_info).

    Raises:
        ExtractionError: If docling is not installed or extraction fails.
    """
    if not shutil.which("docling"):
        msg = (
            "docling CLI not found on PATH. "
            "Install it with: pip install docling"
        )
        raise ExtractionError(msg)

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    cmd = [
        "docling",
        "--to", "md",
        "--output", str(out),
    ]

    if config.docling_vlm:
        cmd.extend(["--pipeline", "vlm"])

    cmd.append(pdf_path)

    log.info("docling.start", pdf=pdf_path, vlm=config.docling_vlm)

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _stdout, stderr = await proc.communicate()

    if proc.returncode != 0:
        msg = f"docling exited with code {proc.returncode}: {stderr.decode().strip()}"
        log.error("docling.failed", returncode=proc.returncode, stderr=stderr.decode())
        raise ExtractionError(msg)

    log.info("docling.complete", pdf=pdf_path)

    # Find the generated markdown file
    md_files = list(out.glob("**/*.md"))
    if not md_files:
        msg = f"No markdown output found in {out}"
        raise ExtractionError(msg)

    markdown = md_files[0].read_text(encoding="utf-8")

    # Collect extracted images
    images: list[Path] = []
    for ext in ("*.png", "*.jpg", "*.jpeg", "*.bmp", "*.tiff"):
        images.extend(out.glob(f"**/{ext}"))

    # Collect table info from any generated table files
    tables: list[dict[str, object]] = []
    for table_file in sorted(out.glob("**/*.csv")):
        tables.append({
            "source": str(table_file),
            "format": "csv",
            "name": table_file.stem,
        })

    return markdown, images, tables
