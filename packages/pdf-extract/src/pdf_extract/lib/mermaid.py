"""Mermaid diagram helpers: validation, rendering, extraction."""
from __future__ import annotations

import base64
import re
import subprocess
import zlib

import structlog

log = structlog.get_logger(__name__)


def validate_mermaid_syntax(code: str) -> bool:
    """Validate Mermaid syntax using merval CLI.

    Falls back to a basic syntax check if merval is not installed.
    """
    try:
        result = subprocess.run(
            ["merval", "--input", "-"],
            input=code,
            capture_output=True,
            text=True,
            timeout=10,
        )
        valid = result.returncode == 0
        if not valid:
            log.debug("mermaid.validate.fail", stderr=result.stderr[:200])
        return valid
    except FileNotFoundError:
        log.debug("mermaid.validate.merval_not_found, using_basic_check")
        return _basic_syntax_check(code)
    except subprocess.TimeoutExpired:
        log.warning("mermaid.validate.timeout")
        return False


def _basic_syntax_check(code: str) -> bool:
    """Minimal Mermaid syntax validation: check for a known diagram type keyword."""
    code_stripped = code.strip()
    known_types = (
        "graph", "flowchart", "sequenceDiagram", "classDiagram",
        "stateDiagram", "erDiagram", "gantt", "pie", "mindmap",
        "gitgraph", "journey", "quadrantChart", "sankey",
    )
    first_line = code_stripped.split("\n", 1)[0].strip()
    return any(first_line.startswith(t) for t in known_types)


def render_mermaid_kroki(code: str) -> bytes | None:
    """Render Mermaid code to PNG via the Kroki API.

    Returns PNG bytes on success, None on failure.
    """
    import urllib.error
    import urllib.request

    try:
        compressed = zlib.compress(code.encode("utf-8"), level=9)
        encoded = base64.urlsafe_b64encode(compressed).decode("ascii")
        url = f"https://kroki.io/mermaid/png/{encoded}"

        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=15) as resp:
            png_bytes: bytes = resp.read()

        log.debug("mermaid.render.ok", size=len(png_bytes))
        return png_bytes
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        log.warning("mermaid.render.fail", error=str(exc))
        return None


def extract_mermaid_from_text(text: str) -> str | None:
    """Extract the first ```mermaid ... ``` fenced code block from text."""
    match = re.search(r"```mermaid\s*\n(.*?)```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return None
