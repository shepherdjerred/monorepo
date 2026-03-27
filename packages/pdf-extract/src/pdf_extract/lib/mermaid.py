"""Mermaid diagram helpers: validation, rendering, extraction."""
from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import structlog

log = structlog.get_logger(__name__)


def validate_mermaid_syntax(code: str) -> bool:
    """Validate Mermaid syntax by attempting to render with mmdc.

    Returns True if the code is valid Mermaid, False otherwise.
    """
    if not shutil.which("mmdc"):
        msg = "mmdc (mermaid-cli) not found on PATH. Install with: npm install -g @mermaid-js/mermaid-cli"
        raise RuntimeError(msg)

    with tempfile.TemporaryDirectory() as tmp:
        input_path = Path(tmp) / "validate.mmd"
        output_path = Path(tmp) / "validate.svg"
        input_path.write_text(code)

        try:
            result = subprocess.run(
                ["mmdc", "-i", str(input_path), "-o", str(output_path), "--quiet"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            valid = result.returncode == 0
            if not valid:
                log.debug("mermaid.validate.fail", stderr=result.stderr[:200])
            return valid
        except subprocess.TimeoutExpired:
            log.warning("mermaid.validate.timeout")
            return False


def render_mermaid(code: str) -> bytes | None:
    """Render Mermaid code to PNG via mmdc (mermaid-cli).

    Returns PNG bytes on success, None on failure.
    """
    if not shutil.which("mmdc"):
        msg = "mmdc (mermaid-cli) not found on PATH. Install with: npm install -g @mermaid-js/mermaid-cli"
        raise RuntimeError(msg)

    with tempfile.TemporaryDirectory() as tmp:
        input_path = Path(tmp) / "input.mmd"
        output_path = Path(tmp) / "output.png"
        input_path.write_text(code)

        try:
            result = subprocess.run(
                ["mmdc", "-i", str(input_path), "-o", str(output_path), "-b", "white", "--quiet"],
                capture_output=True,
                text=True,
                timeout=15,
            )
            if result.returncode != 0:
                log.warning("mermaid.render.fail", stderr=result.stderr[:200])
                return None

            png_bytes = output_path.read_bytes()
            log.debug("mermaid.render.ok", size=len(png_bytes))
            return png_bytes
        except subprocess.TimeoutExpired:
            log.warning("mermaid.render.timeout")
            return None


def extract_mermaid_from_text(text: str) -> str | None:
    """Extract the first ```mermaid ... ``` fenced code block from text."""
    match = re.search(r"```mermaid\s*\n(.*?)```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return None
