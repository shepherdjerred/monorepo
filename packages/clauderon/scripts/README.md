# Screenshot Generation Scripts

These scripts generate documentation screenshots from the **REAL Clauderon application**.

## Quick Reference

```bash
# Generate CLI screenshots (requires: cargo build --release)
./scripts/generate-cli-screenshots.sh

# Generate TUI screenshots (requires: cargo build)
cargo test --test screenshot_tests -- --ignored

# Generate web screenshots (requires: daemon + dev server running)
cd web/frontend && bun run screenshots

# Copy all to docs
./scripts/update-docs-screenshots.sh
```

## What Each Script Does

### `generate-cli-screenshots.sh`

- **Input**: Real `clauderon` binary (from `target/release/` or `target/debug/`)
- **Output**: SVG files in `screenshots/cli/`
- **Format**: SVG (vector graphics, scales well)
- **Requirements**: Clauderon binary must be built first

Generates screenshots by running actual CLI commands and wrapping output in SVG templates.

### `screenshot_tests.rs` (TUI)

- **Input**: Real TUI components via ratatui TestBackend
- **Output**: PNG files in `screenshots/tui/`
- **Format**: PNG with monospace font rendering
- **Requirements**: Image processing crates (`image`, `ab_glyph`, `imageproc`)

Uses the actual App state and UI rendering code to generate pixel-perfect screenshots.

### Playwright Tests (Web)

- **Input**: Real React application at http://localhost:5173
- **Output**: PNG files in `screenshots/web/`
- **Format**: PNG (browser screenshots)
- **Requirements**:
  - Daemon running (`clauderon daemon`)
  - Dev server running (`bun run dev`)
  - Playwright browsers installed

Launches headless Chromium to screenshot the actual web application.

### `update-docs-screenshots.sh`

- **Input**: Screenshots from `screenshots/`
- **Output**: Copied to `docs/src/assets/screenshots/`
- **Purpose**: Make screenshots available to Astro docs site

Simple copy script that maintains directory structure (cli/, tui/, web/).

### `generate-all-screenshots.sh`

- **Master orchestration script**
- Runs all three screenshot generation methods in sequence
- Copies results to docs
- Provides summary of what was generated

## Full Documentation

See `/workspace/packages/clauderon/SCREENSHOT_GENERATION.md` for complete instructions.
