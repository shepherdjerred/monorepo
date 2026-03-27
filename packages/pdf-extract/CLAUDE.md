# pdf-extract

Maximum-fidelity PDF to Markdown extraction with multi-model VLM verification and anti-hallucination stack. Python 3.12+, managed with `uv`.

## Commands

```bash
# Install
cd packages/pdf-extract && uv sync --all-extras

# Run
uv run pdf-extract document.pdf
uv run pdf-extract document.pdf -o output/ --backend docling
uv run pdf-extract document.pdf --fast            # Skip verification (layers 1-4)
uv run pdf-extract document.pdf --no-handwriting  # Skip handwriting detection
uv run pdf-extract document.pdf --metrics run.json # Write metrics JSON
uv run pdf-extract document.pdf --config custom.toml

# Backends
uv run pdf-extract document.pdf --backend docling  # Default, MIT, GraniteDocling VLM
uv run pdf-extract document.pdf --backend mineru   # Optional, via subprocess

# Tests
uv run pytest                        # Unit tests only (skips integration)
uv run pytest -m integration         # Integration tests (needs API keys + extractors)
uv run pytest -m slow                # Slow tests (>10s)
uv run pytest --snapshot-update      # Update syrupy snapshots

# Type checking & lint
uv run mypy src/                     # Strict mode
uv run ruff check src/ --fix
uv run ruff format src/
```

## Environment Variables

| Variable           | Required for             |
| ------------------ | ------------------------ |
| `GOOGLE_API_KEY`   | Gemini Flash/Pro (verification, handwriting, image classification) |
| `ANTHROPIC_API_KEY`| Claude Sonnet/Opus (MEDIUM/LOW/UNRESOLVED escalation) |
| `OPENAI_API_KEY`   | GPT-4o (LOW escalation consensus) |

All keys can also be set in the TOML config file. Pipeline runs without keys but skips phases that need them.

## Architecture

### Pipeline Phases (sequential)

1. **Extraction** (`phases/extract.py`) — Docling (default) or MinerU via subprocess
2. **Preprocessing** (`phases/preprocess.py`) — Conditional: deskew, denoise, FSRCNN upscale for failed pages only
3. **Annotations** (`phases/annotations.py`) — PyMuPDF inline annotation extraction (highlights, freehand, shapes)
4. **Handwriting** (`phases/handwriting.py`) — Single-call detection (Gemini Flash) + per-page extraction (Gemini Pro)
5. **Images** (`phases/images.py`) — Classify, diagram-to-Mermaid, chart-to-data, equation-to-LaTeX
6. **Verification** (`verify/stack.py`) — 4-layer verification stack (see below)
7. **Assembly** (`report.py`) — Merge all outputs, append quality report

### Verification Stack (4 layers)

1. **Anchored** (`verify/anchored.py`) — Gemini Flash compares every page screenshot against extracted text
2. **Tables** (`verify/tables.py`) — Structure verification + cell-by-cell OCR + column-type consistency
3. **Domain** (`verify/domain.py`) — Regex validators (dates, emails, currencies, phones, percentages) + correction gating (length ratio, confusion-pair filter)
4. **Escalation** (`verify/escalation.py`) — HIGH=auto-accept, MEDIUM=Claude Sonnet, LOW=Sonnet+GPT-4o consensus, UNRESOLVED=Opus (budget-capped)

**Geometric Risk Controller** (`verify/geometric.py`) — K geometric views of uncertain regions, consensus vote. Used by escalation for flagged regions.

### Anti-Hallucination Techniques

- Refusal-to-answer prompting: all VLM prompts include "[UNREADABLE] rather than guessing"
- Grounded CoT: corrections must cite bounding box locations
- Confusion-pair filter: single-char corrections only accepted for known pairs (0/O, 1/l/I, etc.)
- Length-ratio gate: rejects corrections with suspicious length changes
- Multi-model consensus: LOW tier requires 2+ models to agree on same correction
- Opus budget cap: max N Opus calls per run (configurable)

## Key Files

| File | Purpose |
| ---- | ------- |
| `config.py` | TOML config -> frozen `PipelineConfig` dataclass |
| `metrics.py` | `PipelineMetrics`, `APIMetrics`, `VerificationMetrics` |
| `lib/prompts.py` | ALL LLM prompts (single file for review/tuning) |
| `lib/protocols.py` | `VisionExtractor` Protocol (common LLM interface) |
| `lib/gemini.py` | Gemini client (tenacity retry, semaphore, Flash/Pro metrics) |
| `lib/claude.py` | Claude client (Sonnet/Opus metrics split) |
| `lib/openai_client.py` | GPT-4o client |
| `lib/pdf.py` | PyMuPDF helpers: render, crop, text extract |
| `lib/imaging.py` | OpenCV: FSRCNN upscale, deskew, denoise |
| `lib/mermaid.py` | merval validation + Kroki rendering |
| `pipeline.py` | Main orchestrator connecting all phases |
| `report.py` | Final assembly + quality report generation |
| `config.default.toml` | Default TOML configuration |

## External Tools (subprocess, not Python deps)

- **docling** — Default extraction backend. Install separately: `pip install docling`
- **mineru** — Optional backend: `pip install magic-pdf`
- **merval** — Mermaid syntax validator (optional): `npm install -g merval`
- **kroki** — Diagram renderer (optional, uses public API by default)

## Config

TOML config at `config.default.toml`. CLI flags override TOML values. Frozen dataclass means config is immutable after parse. Key sections: `[pipeline]`, `[extraction]`, `[preprocessing]`, `[handwriting]`, `[images]`, `[verification]`, `[escalation]`, `[prompts]`, `[domain]`.
