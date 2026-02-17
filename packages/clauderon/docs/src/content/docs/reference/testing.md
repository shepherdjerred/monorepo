---
title: Testing
description: Testing strategy and patterns across all components
---

clauderon uses a comprehensive testing strategy across all components: Rust backend/TUI, Web, and Mobile.

## Quick Start

Run all tests by component:

```bash
# Rust (Backend + TUI/CLI)
cargo nextest run                      # All tests (faster than cargo test)
cargo nextest run --run-ignored all    # Include E2E tests
mise run test-fast                     # via mise

# Web (TypeScript/React)
cd web && bun run test                 # All web tests

# Mobile (React Native)
cd mobile && bun test                  # Jest tests

# Full build + test (CI simulation)
dagger call ci
```

## Rust (Backend + TUI/CLI)

### Test Organization

**44 test files** across the codebase:

- `tests/` directory: Integration and E2E tests (24 files)
- `src/` directory: Unit tests with `#[cfg(test)]` (colocated with implementation)

### Commands

```bash
cargo nextest run                      # Run all tests
cargo nextest run --run-ignored all    # Include E2E tests
cargo nextest run -E 'test(/pattern/)' # Filter by pattern
mise run test-fast                     # Run via mise
```

If `nextest` is not installed: `mise run setup-tools`

### Frameworks and Dependencies

- **tokio-test**: Async testing runtime
- **proptest**: Property-based testing
- **tempfile**: Temporary file/directory creation
- **assert_cmd**: CLI testing
- **predicates**: Assertion helpers

### Test Patterns

#### Unit Tests

Colocated with implementation using `#[cfg(test)]`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_function() {
        // Test logic
    }
}
```

**Example:** `src/utils/random.rs:46-76`

#### Integration Tests

Located in `tests/` directory with `#[tokio::test]`:

**Example:** `tests/api_tests.rs`

#### Conditional E2E Tests

Tests marked with `#[ignore]` skip when dependencies (Docker, Kubernetes) are unavailable:

**Example:** `tests/e2e_docker.rs:44-77`

```rust
#[tokio::test]
#[ignore]
async fn test_docker_session() {
    skip_if_no_docker!();
    // Test logic
}
```

#### Mock Implementations

Mock backends for testing without external dependencies:

- `MockGitBackend`: Simulates git operations
- `MockApiClient`: Simulates API calls

**Example:** `src/backends/mock.rs`

### Test Helpers

Located in `tests/common/mod.rs`:

#### Availability Checks

Functions to check if required dependencies are available:

```rust
pub fn docker_available() -> bool
pub fn kubernetes_available() -> bool
```

#### Skip Macros

Gracefully skip tests when dependencies are unavailable:

```rust
skip_if_no_docker!()
skip_if_no_kubernetes!()
```

#### Git Repository Initialization

```rust
pub fn init_git_repo(path: &Path)
```

#### RAII Cleanup Guards

Automatic cleanup using Drop trait:

```rust
pub struct SpriteCleanupGuard
```

**Reference:** `tests/common/mod.rs`

## Web (TypeScript/React)

### Test Organization

**9 test files** across web packages:

- `web/frontend/src/`: React component and utility tests
- `web/client/src/`: Client library tests

### Commands

```bash
cd web && bun run test                 # All web tests
cd web/frontend && bun test            # Frontend only
cd web/client && bun test              # Client only
```

### Framework

Uses **Bun's native `bun:test`** runner:

- Fast execution
- Built-in TypeScript support
- Native mocking capabilities

### Test Patterns

#### Describe/Test Blocks

```typescript
import { describe, test, expect } from "bun:test";

describe("Component", () => {
  test("should render correctly", () => {
    // Test logic
  });
});
```

#### Mock Implementations

##### Browser API Mocks

**Example:** `web/frontend/src/components/ThemeToggle.test.tsx:7-24`

Mocking `localStorage` and `matchMedia`:

```typescript
const mockLocalStorage = {
  getItem: () => null,
  setItem: () => {},
};
```

##### WebSocket Mocking

**Example:** `web/client/src/ConsoleClient.test.ts:12-50`

Controlled WebSocket behavior for testing:

```typescript
class MockWebSocket {
  readyState = WebSocket.CONNECTING;
  onopen?: () => void;
  onerror?: () => void;
  // ...
}
```

#### Async Testing with Controlled Timing

**Example:** `web/client/src/ConsoleClient.test.ts:90-123`

Using `await new Promise(resolve => setTimeout(resolve, 0))` for async state updates.

#### Factory Functions

**Example:** `web/frontend/src/lib/claudeParser.test.ts`

Creating test data with factory functions for consistency.

## Mobile (React Native)

### Test Organization

**1 test file** currently:

- `mobile/src/lib/historyParser.test.ts`

Infrastructure ready for component tests (`react-test-renderer` installed).

### Commands

```bash
cd mobile && bun test                  # Jest tests
cd mobile && bun test:windows          # Windows-specific
```

### Framework

**Jest** with `@rnx-kit/jest-preset`:

- React Native preset configuration
- TypeScript transformation
- Module name mapping

**Example:** `mobile/src/lib/historyParser.test.ts`

## CI/CD Integration

### Dagger Pipeline

Located in `/.dagger/src/index.ts` (see `clauderonCi` function).

**Pipeline Steps:**

1. Build docs package (`cd docs && bun run build`)
2. Build web package (`cd web && bun run build`)
3. Build Rust binary (`cargo build`)
4. Run clippy (`cargo clippy`)
5. Run tests (`cargo nextest run`)
6. Create release artifacts

### Caching

Optimized caching for faster builds:

- Cargo registry
- Git dependencies
- Target directory
- sccache (compiler cache)

### Local Execution

```bash
dagger call ci
```

## Test Types

### Unit Tests

- **Purpose**: Test individual functions/modules in isolation
- **Location**:
  - Rust: In-module with `#[cfg(test)]`
  - Web/Mobile: Colocated `.test.ts(x)` files
- **Characteristics**: Fast, no external dependencies

### Integration Tests

- **Purpose**: Test component interactions
- **Location**:
  - Rust: `tests/` directory
  - Web/Mobile: Colocated with source files
- **Characteristics**: May use test helpers, mock dependencies

### E2E Tests

- **Purpose**: Test complete workflows with real dependencies
- **Location**: Rust `tests/` directory
- **Characteristics**:
  - Marked with `#[ignore]` attribute
  - Conditional execution based on environment
  - Require Docker, Kubernetes, or other services

## Common Patterns

### Conditional Test Execution (Rust)

Check availability before running tests requiring external dependencies:

```rust
#[tokio::test]
#[ignore]
async fn test_requires_docker() {
    skip_if_no_docker!();
    // Test logic that requires Docker
}
```

**Reference:** `tests/common/mod.rs` for availability checks and skip macros.

### Mock Patterns (Web)

#### Browser API Mocking

**Reference:** `web/frontend/src/components/ThemeToggle.test.tsx:7-24`

Mock `localStorage`, `matchMedia`, and other browser APIs:

```typescript
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
};

Object.defineProperty(window, "localStorage", {
  value: mockLocalStorage,
});
```

#### WebSocket Mocking

**Reference:** `web/client/src/ConsoleClient.test.ts:12-50`

Create controlled WebSocket instances for testing connection states:

```typescript
class MockWebSocket {
  readyState = WebSocket.CONNECTING;

  simulateOpen() {
    this.readyState = WebSocket.OPEN;
    this.onopen?.();
  }

  simulateError() {
    this.onerror?.(new Event("error"));
  }
}
```

### Cleanup and Resource Management

#### RAII Pattern (Rust)

Use Drop trait for automatic cleanup:

```rust
pub struct TestCleanup {
    path: PathBuf,
}

impl Drop for TestCleanup {
    fn drop(&mut self) {
        // Cleanup logic
    }
}
```

**Example:** `SpriteCleanupGuard` in `tests/common/mod.rs`

## Troubleshooting

### nextest not found

Install test tools:

```bash
mise run setup-tools
```

### Tests fail in CI but pass locally

Check Docker/Kubernetes availability:

```bash
docker ps  # Check Docker
kubectl cluster-info  # Check Kubernetes
```

E2E tests are designed to skip gracefully when dependencies are unavailable.

### E2E tests always skip

This is expected behavior when:

- Docker is not running
- Kubernetes cluster is not configured
- Required credentials are not available

To run E2E tests:

```bash
cargo nextest run --run-ignored all
```

### Test timing issues (Web)

Use controlled async timing:

```typescript
// Wait for async updates
await new Promise((resolve) => setTimeout(resolve, 0));
```

**Reference:** `web/client/src/ConsoleClient.test.ts`
