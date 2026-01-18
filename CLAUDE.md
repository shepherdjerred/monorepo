# CLAUDE.md

This file provides guidance to Claude Code when working with this monorepo.

## Package Manager

**Bun** is the primary package manager and runtime. Always use `bun` commands:

```bash
bun install              # Install dependencies
bun run <script>         # Run package scripts
bunx <package>           # Execute packages
bun test                 # Run tests
```

Never use npm, yarn, or pnpm.

## Monorepo Structure

This is a Bun workspaces monorepo with packages in `packages/`:

- **birmel** - AI-powered Discord bot (Mastra + Claude AI)
- **eslint-config** - Shared ESLint configuration with custom rules
- **dagger-utils** - Utilities for Dagger CI/CD pipelines
- **a2ui-poc** - POC app with Bun backend and React/Vite frontend
- **claude-plugin** - Claude Code plugin with specialized agents

Additional directories:
- `.dagger/` - Dagger CI/CD pipeline definitions
- `archive/` - Archived legacy projects (do not modify)
- `practice/` - Learning projects

## Common Commands

Run from repository root:

```bash
bun run build            # Build all packages
bun run test             # Test all packages
bun run typecheck        # Typecheck all packages
```

Run for a specific package:

```bash
bun run --filter='./packages/birmel' test
bun run --filter='./packages/eslint-config' build
```

## Linting

Uses **ESLint v9** with flat config format. Each package has its own `eslint.config.js`.

The shared config (`@shepherdjerred/eslint-config`) includes custom rules:
- `prefer-bun-apis` - Use Bun APIs over Node.js equivalents
- `no-type-assertions` - Avoid TypeScript type assertions
- `zod-schema-naming` - Enforce Zod schema naming conventions
- `prefer-date-fns` - Use date-fns over native Date

Run linting:

```bash
cd packages/<name> && bunx eslint .
cd packages/<name> && bunx eslint --fix .
```

## TypeScript

Strict TypeScript configuration with these key settings:
- `strict: true` with all strict flags enabled
- `verbatimModuleSyntax: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`

All packages extend `tsconfig.base.json` from the root.

## Testing

Uses **Bun's native test runner**:

```bash
bun test                           # Run tests
bun --env-file=.env.test test      # With environment file
```

Test files follow patterns: `*.test.ts`, `*.integration.test.ts`

### Birmel Testing

Requires Prisma setup before tests:

```bash
cd packages/birmel
bunx --env-file=.env.test prisma generate
bun --env-file=.env.test test
```

## Development Environment

Uses **Mise** for tool version management. After checkout:

```bash
mise trust
mise dev
```

This ensures correct versions of `bun` and `dagger` are available.

## CI/CD

Uses **Dagger** for CI/CD pipelines. The pipeline runs:

1. Install dependencies (`--frozen-lockfile`)
2. Prisma generate + db push
3. Typecheck
4. Test
5. Build

Run locally:

```bash
dagger call ci
```

## Git Hooks

**Husky** manages git hooks:
- **pre-commit**: Runs `lint-staged` (ESLint on staged files)
- **post-checkout**: Sets up Mise for new worktrees

## Code Style Guidelines

- Prefer Bun APIs over Node.js equivalents
- Use Zod for runtime validation
- Avoid type assertions and type guards where possible
- No parent directory imports (`../`)
- No re-exports - use direct imports
- Prisma clients must be disconnected in tests

## Package-Specific Notes

### birmel

Discord bot using Mastra for AI agent orchestration:

```bash
cd packages/birmel
bun run dev              # Development with watch mode
bun run start            # Production start
bun run studio:dev       # Mastra studio
```

Requires `.env` file with Discord and AI API keys.

### eslint-config

Shared ESLint configuration package:

```bash
cd packages/eslint-config
bun run build            # Compile TypeScript to dist/
bun run typecheck
```

### a2ui-poc

Full-stack app with Hono backend and React frontend:

```bash
cd packages/a2ui-poc
bun run dev              # Backend with watch
bun run dev:frontend     # Frontend dev server
bun run dev:all          # Both concurrently
```

### clauderon

Rust-based session manager with web interface. Contains nested TypeScript workspaces and documentation:

```bash
cd packages/clauderon
cargo build              # Build Rust binary
cargo test               # Run Rust tests

# Web packages (nested workspace)
cd web
bun install              # Install web dependencies
bun run build            # Build all web packages
bun run test             # Run web tests
bun run lint             # Lint web packages

# Documentation site (Astro + Starlight)
cd docs
bun install              # Install docs dependencies
bun run dev              # Start docs dev server
bun run build            # Build static site
bun run preview          # Preview built docs
```

**Build Order**: Both frontend and docs must be built before the Rust binary (static files are embedded):
1. `cd packages/clauderon/docs && bun run build`
2. `cd packages/clauderon/web/frontend && bun run build`
3. `cd packages/clauderon && cargo build`

**Documentation**: The docs are built with Astro + Starlight and served in two ways:
- Embedded in Rust binary at `/docs` route (localhost:3030/docs)
- Standalone static site for S3 deployment (from `docs/dist/`)

**Nested Workspace Exception**: The web packages (`packages/clauderon/web/*`) and docs package use standalone ESLint configs instead of `@shepherdjerred/eslint-config` due to Bun workspace resolution limitations with deeply nested packages. These configs follow the same patterns and rules as the shared config.

## Observability & Debugging Guidelines

All code must be observable and debuggable. Follow these practices:

### Logging

- **Structured Logging**: Use `#[instrument]` macro on public functions for automatic span tracking
- **Log Levels**:
  - `error!` - Unrecoverable failures
  - `warn!` - Recoverable issues, degraded functionality
  - `info!` - Important state changes, lifecycle events
  - `debug!` - Detailed operation information
  - `trace!` - Very verbose, function entry/exit
- **Context**: Include relevant IDs (session_id, correlation_id) in all log statements
- **Error Context**: Use `.context()` to add context to errors with specific details

### Error Handling

- **Custom Error Types**: Use `thiserror` for domain-specific errors (SessionError, BackendError)
- **Rich Context**: Errors must include:
  - What operation was being attempted
  - Relevant resource IDs
  - Paths, URLs, or configuration values
  - Source errors (use `#[source]`)
- **Never Swallow Errors**: Log errors even if they're handled

### Testing Observability

- **Test Logging**: Initialize logging in test setup
- **Mock Logging**: Mock implementations should log operations
- **Assertion Context**: Include expected vs actual in assertion messages
- **Integration Tests**: Verify logs contain expected information

### Example

```rust
use tracing::instrument;
use anyhow::Context;

#[instrument(skip(self), fields(session_id = %session_id))]
pub async fn delete_session(&self, session_id: Uuid) -> anyhow::Result<()> {
    let session = self.get_session(session_id)
        .await
        .context("Failed to fetch session for deletion")?;

    self.backend.delete(&session.backend_id)
        .await
        .with_context(|| format!(
            "Failed to delete backend {} for session {}",
            session.backend_id,
            session_id
        ))?;

    tracing::info!(
        session_id = %session_id,
        session_name = %session.name,
        "Successfully deleted session"
    );

    Ok(())
}
```
