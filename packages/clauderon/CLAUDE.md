# CLAUDE.md - Clauderon

Session manager for AI coding agents with isolated execution environments and zero-credential proxy.

## Multi-Platform Consideration

**When implementing features, consider all interfaces:**
- CLI (`src/main.rs`) - Clap commands
- TUI (`src/tui/`) - Ratatui terminal UI
- Web UI (`web/frontend/`) - React + Vite
- Mobile (`mobile/`) - React Native (iOS, iPadOS, Android, macOS, Windows)
- Docs (`docs/`) - Astro + Starlight

## Commands

```bash
# Build order (static files embed in binary)
cd docs && bun run build
cd web && bun run build
cargo build

# Development
cargo run -- tui
cargo run -- serve

# Mobile
cd mobile && bun run ios|android|macos
```

## Testing

**Quick Reference:**

```bash
# Rust (Backend + TUI/CLI)
cargo nextest run                      # All tests (faster than cargo test)
cargo nextest run --run-ignored all    # Include E2E tests
cargo nextest run -E 'test(/pattern/)' # Filter tests
mise run test-fast                     # via mise

# Web (TypeScript/React)
cd web && bun run test                 # All web tests
cd web/frontend && bun test            # Frontend only
cd web/client && bun test              # Client only

# Mobile (React Native)
cd mobile && bun test                  # Jest tests
cd mobile && bun test:windows          # Windows-specific

# Full build + test (CI simulation)
dagger call ci
```

**Test Organization:**
- **Rust**: 44 test files (24 in `tests/`, unit tests in `src/`)
- **Web**: 9 test files (colocated with `.test.ts(x)`)
- **Mobile**: Jest setup with `@rnx-kit/jest-preset`

**Key Patterns:**
- **Conditional E2E**: Tests marked `#[ignore]` skip when Docker/K8s unavailable
- **Test Helpers**: See `tests/common/mod.rs` for availability checks, skip macros, cleanup guards
- **Mocks**: Mock backends (`MockGitBackend`, `MockApiClient`) for testing without external deps

**See [Testing Guide](docs/src/content/docs/reference/testing.md) for comprehensive documentation.**

## Screenshots

Generate screenshots for documentation (committed to git):

```bash
# Generate all screenshots (CLI, TUI, Web UI)
./scripts/generate-all-screenshots.sh

# Generate individual types
./scripts/generate-cli-screenshots.sh          # SVG screenshots via custom script
cargo test --test screenshot_tests -- --ignored # PNG screenshots via ratatui TestBackend
cd web/frontend && bun run screenshots          # PNG screenshots via Playwright

# Copy to docs
./scripts/update-docs-screenshots.sh
```

**Output locations:**
- Source: `screenshots/{cli,tui,web}/`
- Docs: `docs/src/assets/screenshots/{cli,tui,web}/`

**Technologies:**
- CLI: Custom SVG generator (bash + heredoc templates)
- TUI: ratatui TestBackend → PNG (image, ab_glyph crates)
- Web: Playwright headless browser → PNG

## Mise Tasks

```bash
mise run build                         # Full build
mise run test-fast                     # Run tests with nextest
mise run setup-tools                   # Install nextest, bacon, cargo-watch
```

## CI

CI runs via Dagger (see `/.dagger/`). The pipeline:
1. Builds docs and web packages
2. Builds Rust binary
3. Runs clippy and tests
4. Creates release artifacts

Run locally: `dagger call ci`

## Architecture

- **Backends** implement `ExecutionBackend` trait (`src/backends/traits.rs`)
- **TypeShare** generates TS types from Rust (`#[typeshare]` → `web/shared/`)
- **Zero-credential proxy** injects tokens; containers never see credentials
- **SQLite** for persistence (`~/.clauderon/db.sqlite`)

## Conventions

- `#[instrument]` on public async functions
- `anyhow::Context` for error context with operation details
- `thiserror` for domain-specific errors
- Correlation IDs in logs
