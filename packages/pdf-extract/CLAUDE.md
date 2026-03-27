# pdf-extract

Maximum-fidelity PDF to Markdown extraction with multi-model VLM verification and anti-hallucination stack. Python 3.12+, managed with `uv`.

## Setup

```bash
# 1. Python package
cd packages/pdf-extract && uv sync --all-extras

# 2. Extraction backend (required)
pip install docling

# 3. Mermaid CLI (required — validation + rendering)
npm install -g @mermaid-js/mermaid-cli

# 4. API keys (required — copy .env.example to .env and fill in)
cp .env.example .env
# Then edit .env with your keys

# Optional: MinerU backend (alternative to Docling)
pip install mineru[all]
```

## Commands

```bash
# Run
uv run pdf-extract document.pdf
uv run pdf-extract document.pdf -o output/
uv run pdf-extract document.pdf --fast            # Skip verification
uv run pdf-extract document.pdf --no-handwriting  # Skip handwriting detection
uv run pdf-extract document.pdf --metrics run.json # Write metrics JSON
uv run pdf-extract document.pdf --config custom.toml
uv run pdf-extract document.pdf --backend mineru   # Use MinerU instead of Docling

# Tests
uv run pytest                        # Unit + e2e tests (73 tests, no API keys needed)
uv run pytest -m integration         # Integration tests (needs API keys + extractors)
uv run mypy src/                     # Strict mode
uv run ruff check src/ --fix
```

## Required Dependencies

| Dependency | Install | Purpose |
|---|---|---|
| `docling` | `pip install docling` | Default extraction backend (MIT) |
| `mmdc` | `npm install -g @mermaid-js/mermaid-cli` | Mermaid validation + rendering |
| `GOOGLE_API_KEY` | Set in `.env` | Gemini 3.1 Pro (verification, handwriting, images) |
| `ANTHROPIC_API_KEY` | Set in `.env` | Claude Sonnet 4.6 + Opus 4.6 (escalation) |
| `OPENAI_API_KEY` | Set in `.env` | GPT-5.4 (LOW-tier consensus) |

All checked at startup. Pipeline will not run with missing dependencies.

## Models Used

| Provider | Model | API ID | Purpose |
|---|---|---|---|
| Google | Gemini 3.1 Pro | `gemini-3.1-pro-preview` | Anchored verification, handwriting, image classification |
| Anthropic | Claude Sonnet 4.6 | `claude-sonnet-4-6` | MEDIUM confidence escalation |
| Anthropic | Claude Opus 4.6 | `claude-opus-4-6` | UNRESOLVED escalation (nuclear option) |
| OpenAI | GPT-5.4 | `gpt-5.4` | LOW confidence multi-model consensus |

## Architecture

### Pipeline Phases (sequential)

1. **Extraction** (`phases/extract.py`) — Docling (default) or MinerU via subprocess
2. **Preprocessing** (`phases/preprocess.py`) — Conditional: deskew, denoise, FSRCNN upscale for failed pages only
3. **Annotations** (`phases/annotations.py`) — PyMuPDF inline annotation extraction (highlights, freehand, shapes)
4. **Handwriting** (`phases/handwriting.py`) — Single-call detection + per-page extraction (Gemini 3.1 Pro)
5. **Images** (`phases/images.py`) — Classify, diagram-to-Mermaid, chart-to-data, equation-to-LaTeX
6. **Verification** (`verify/stack.py`) — 4-layer verification stack
7. **Assembly** (`report.py`) — Merge all outputs, append quality report

### Verification Stack (4 layers)

1. **Anchored** (`verify/anchored.py`) — Gemini compares every page screenshot against extracted text
2. **Tables** (`verify/tables.py`) — Structure verification + cell-by-cell OCR + column-type consistency
3. **Domain** (`verify/domain.py`) — Regex validators + correction gating (length ratio, confusion-pair filter)
4. **Escalation** (`verify/escalation.py`) — HIGH=accept, MEDIUM=Claude, LOW=Claude+GPT-5.4 consensus, UNRESOLVED=Opus

**Geometric Risk Controller** (`verify/geometric.py`) — K geometric views of uncertain regions, consensus vote.

### Anti-Hallucination Techniques

- Refusal-to-answer: all prompts include "[UNREADABLE] rather than guessing"
- Grounded CoT: corrections must cite bounding box locations
- Confusion-pair filter: single-char corrections only for known pairs (0/O, 1/l/I, 5/S, 8/B, rn/m)
- Length-ratio gate: rejects suspicious length changes
- Multi-model consensus: LOW tier requires 2+ models to agree
- Geometric risk controller: 5 transforms, consensus vote on uncertain regions

## Key Files

| File | Purpose |
|---|---|
| `config.default.toml` | Default TOML configuration |
| `config.py` | TOML -> frozen `PipelineConfig` dataclass |
| `metrics.py` | `PipelineMetrics`, `APIMetrics`, `VerificationMetrics` |
| `lib/prompts.py` | ALL LLM prompts (single file for review/tuning) |
| `lib/protocols.py` | `VisionExtractor` Protocol |
| `lib/gemini.py` | Gemini client (tenacity retry, semaphore) |
| `lib/claude.py` | Claude client (Sonnet/Opus) |
| `lib/openai_client.py` | GPT-5.4 client |
| `lib/pdf.py` | PyMuPDF helpers |
| `lib/imaging.py` | OpenCV: FSRCNN upscale, deskew, denoise |
| `lib/mermaid.py` | mmdc validation + rendering |
| `pipeline.py` | Main orchestrator |
| `report.py` | Final assembly + quality report |

## Config

TOML config at `config.default.toml`. CLI flags override TOML values. Key sections: `[pipeline]`, `[extraction]`, `[preprocessing]`, `[handwriting]`, `[images]`, `[verification]`, `[escalation]`, `[prompts]`, `[domain]`.
