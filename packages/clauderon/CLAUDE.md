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

Prefer `cargo nextest run` over `cargo test` for faster parallel execution:

```bash
cargo nextest run                      # Run all tests
cargo nextest run --run-ignored all    # Include ignored tests
cargo nextest run -E 'test(/recent/)'  # Filter by pattern
mise run test-fast                     # Run via mise
cargo watch -x "nextest run"           # Auto-run tests on file changes
```

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
