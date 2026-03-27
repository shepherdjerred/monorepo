"""CLI entry point for pdf-extract."""
from __future__ import annotations

import argparse
import asyncio
import os
import shutil
import sys
from pathlib import Path

from pdf_extract import __version__
from pdf_extract.config import PipelineConfig
from pdf_extract.lib import get_logger, setup_logging


def _load_dotenv() -> None:
    """Load .env file from package root if it exists. No external deps."""
    env_path = Path(__file__).parent.parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="pdf-extract",
        description="Maximum-fidelity PDF to Markdown extraction.",
    )
    p.add_argument("pdf", type=Path, help="Path to PDF file")
    p.add_argument("-o", "--output", type=Path, default=Path("output"), help="Output directory")
    p.add_argument("-V", "--version", action="version", version=f"%(prog)s {__version__}")

    # Config
    p.add_argument("--config", type=Path, help="TOML config file (default: config.default.toml)")
    p.add_argument("--backend", choices=["docling", "mineru"], help="Extraction backend")

    # Mode flags
    p.add_argument("--fast", action="store_true", help="Skip verification (layers 1-4)")
    p.add_argument("--no-handwriting", action="store_true", help="Skip handwriting detection")
    p.add_argument("--no-annotations", action="store_true", help="Skip annotation extraction")
    p.add_argument("--no-mermaid", action="store_true", help="Skip diagram→Mermaid conversion")

    # Logging & output
    p.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    p.add_argument("--log-json", action="store_true", help="JSON structured logging")
    p.add_argument("--metrics", type=Path, help="Write metrics JSON to this file")
    p.add_argument("--format", choices=["markdown", "json"], default="markdown")

    return p


def _check_requirements(config: PipelineConfig) -> None:
    """Validate all required external tools and API keys are available."""
    errors: list[str] = []

    # Extraction backend
    backend = config.backend
    if not shutil.which(backend):
        install_hint = "pip install docling" if backend == "docling" else "pip install mineru[all]"
        errors.append(f"{backend} CLI not found on PATH. Install with: {install_hint}")

    # API keys
    try:
        config.resolve_api_key("gemini")
    except ValueError:
        errors.append("GOOGLE_API_KEY not set. Required for Gemini Flash/Pro.")
    try:
        config.resolve_api_key("claude")
    except ValueError:
        errors.append("ANTHROPIC_API_KEY not set. Required for Claude Sonnet/Opus.")
    try:
        config.resolve_api_key("openai")
    except ValueError:
        errors.append("OPENAI_API_KEY not set. Required for GPT-5.4.")

    # mmdc (Mermaid validation + rendering)
    if not shutil.which("mmdc"):
        errors.append("mmdc (mermaid-cli) not found on PATH. Install with: npm install -g @mermaid-js/mermaid-cli")

    if errors:
        print("Missing required dependencies:\n", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        print("\nAll dependencies are required for maximum-fidelity extraction.", file=sys.stderr)
        sys.exit(1)


def main(args: list[str] | None = None) -> None:
    _load_dotenv()
    parser = build_parser()
    parsed = parser.parse_args(args)

    if not parsed.pdf.exists():
        print(f"Error: {parsed.pdf} not found", file=sys.stderr)
        sys.exit(1)

    # Load config from TOML, then override with CLI flags
    config = PipelineConfig.from_toml(parsed.config)

    # Apply CLI overrides by creating a new config (frozen dataclass)
    overrides: dict[str, object] = {
        "output_dir": parsed.output,
        "log_level": parsed.log_level,
        "log_json": parsed.log_json,
    }
    if parsed.backend:
        overrides["backend"] = parsed.backend
    if parsed.fast:
        overrides["verify_enabled"] = False
    if parsed.no_handwriting:
        overrides["handwriting_enabled"] = False
    if parsed.metrics:
        overrides["metrics_file"] = parsed.metrics

    # Reconstruct config with overrides
    from dataclasses import asdict

    merged = {**asdict(config), **overrides}
    config = PipelineConfig(**merged)

    setup_logging(config.log_level, json=config.log_json)
    log = get_logger("cli")

    # Validate all required dependencies upfront
    _check_requirements(config)

    log.info("pipeline.start", pdf=str(parsed.pdf), backend=config.backend, fast=parsed.fast)

    # Import here to avoid slow imports on --help
    from pdf_extract.pipeline import extract_pdf

    markdown, metrics = asyncio.run(extract_pdf(str(parsed.pdf), config))

    # Write output
    out_path = config.output_dir / f"{parsed.pdf.stem}.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(markdown)
    log.info("output.written", path=str(out_path), pages=metrics.total_pages)

    if config.metrics_file:
        metrics.write(config.metrics_file)
        log.info("metrics.written", path=str(config.metrics_file))

    # Summary to stdout
    v = metrics.verification
    api = metrics.api
    api.estimate_cost()
    print(f"\n{'=' * 60}")
    print(f"  {parsed.pdf.name} -> {out_path}")
    print(f"  Pages: {metrics.total_pages} | Images: {metrics.images_processed} | Tables: {metrics.tables_found}")
    print(f"  Duration: {metrics.total_duration_ms / 1000:.1f}s")
    print(f"  API calls: {api.gemini_calls} Gemini + {api.claude_sonnet_calls} Sonnet"
          f" + {api.gpt4o_calls} GPT-4o + {api.claude_opus_calls} Opus")
    print(f"  Est. cost: ${api.estimated_cost_usd:.3f}")
    print(f"  Corrections: {v.corrections_proposed} proposed -> {v.corrections_accepted} applied")
    if v.low_confidence_pages:
        print(f"  LOW confidence pages (review recommended): {v.low_confidence_pages}")
    if v.unreadable_regions:
        print(f"  Unreadable regions flagged: {v.unreadable_regions}")
    if v.domain_warnings:
        print(f"  Domain warnings: {v.domain_warnings}")
    print(f"{'=' * 60}")
