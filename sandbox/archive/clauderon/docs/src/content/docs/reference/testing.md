---
title: Testing
description: Testing strategy and patterns across all components
---

## Quick Start

```bash
# Rust (Backend + TUI/CLI)
cargo nextest run                      # All tests
cargo nextest run --run-ignored all    # Include E2E tests
cargo nextest run -E 'test(/pattern/)' # Filter by pattern
mise run test-fast                     # via mise

# Web
cd web && bun run test

# Mobile
cd mobile && bun test

# CI simulation
dagger call ci
```

## Rust

### Organization

- `tests/` -- Integration and E2E tests (24 files)
- `src/` -- Unit tests with `#[cfg(test)]` (colocated)

Install nextest: `mise run setup-tools`

### Frameworks

tokio-test, proptest, tempfile, assert_cmd, predicates

### Patterns

**Unit tests** (colocated):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_function() { /* ... */ }
}
```

**Conditional E2E** (skip when Docker unavailable):

```rust
#[tokio::test]
#[ignore]
async fn test_docker_session() {
    skip_if_no_docker!();
    // ...
}
```

**Mocks:** `MockGitBackend`, `MockApiClient` in `src/backends/mock.rs`

### Test Helpers (`tests/common/mod.rs`)

- `docker_available()` -- dependency check
- `skip_if_no_docker!()` -- graceful skip
- `init_git_repo(path)` -- git repo setup

## Web (TypeScript/React)

### Organization

9 test files across `web/frontend/src/` and `web/client/src/`

```bash
cd web && bun run test          # all
cd web/frontend && bun test     # frontend only
cd web/client && bun test       # client only
```

Uses **Bun's native `bun:test`** runner.

### Patterns

```typescript
import { describe, test, expect } from "bun:test";
describe("Component", () => {
  test("should work", () => {
    /* ... */
  });
});
```

**Browser API mocks** (localStorage, matchMedia): `ThemeToggle.test.tsx`

**WebSocket mocks** (controlled state): `ConsoleClient.test.ts`

**Async timing:** `await new Promise(resolve => setTimeout(resolve, 0))`

## Mobile (React Native)

1 test file: `mobile/src/lib/historyParser.test.ts`

```bash
cd mobile && bun test
cd mobile && bun test:windows
```

Uses **Jest** with `@rnx-kit/jest-preset`. Infrastructure ready for component tests (`react-test-renderer` installed).

## CI/CD

Dagger pipeline (`/.dagger/src/index.ts`, `clauderonCi` function):

1. Build docs (`bun run build`)
2. Build web (`bun run build`)
3. Build Rust (`cargo build`)
4. Clippy (`cargo clippy`)
5. Tests (`cargo nextest run`)
6. Release artifacts

Caches: Cargo registry, git deps, target dir, sccache.

```bash
dagger call ci
```

## Troubleshooting

| Problem                        | Solution                                                   |
| ------------------------------ | ---------------------------------------------------------- |
| nextest not found              | `mise run setup-tools`                                     |
| Tests fail in CI, pass locally | Check Docker: `docker ps`; E2E tests skip gracefully       |
| E2E tests always skip          | Expected without Docker; run with `--run-ignored all`      |
| Web test timing issues         | Use `await new Promise(resolve => setTimeout(resolve, 0))` |
