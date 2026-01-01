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
- **multiplexer** - Rust-based session management for AI coding agents (binary: `mux`)
- **mux-site** - Marketing/documentation site for mux (Astro + Starlight)
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

### multiplexer

Rust-based session management for AI coding agents:

```bash
cd packages/multiplexer
cargo build --release    # Build release binary
cargo test               # Run tests
cargo clippy             # Lint
```

The binary is named `mux`. Requires Rust 1.85+.

### mux-site

Marketing and documentation site built with Astro + Starlight:

```bash
cd packages/mux-site
bun run dev              # Development server
bun run build            # Production build
bun run preview          # Preview production build
```

Note: Uses Astro's TypeScript config, not the monorepo's tsconfig.base.json.

### a2ui-poc

Full-stack app with Hono backend and React frontend:

```bash
cd packages/a2ui-poc
bun run dev              # Backend with watch
bun run dev:frontend     # Frontend dev server
bun run dev:all          # Both concurrently
```

### multiplexer

Rust-based session multiplexer with web interface. Contains nested TypeScript workspaces:

```bash
cd packages/multiplexer
cargo build              # Build Rust binary
cargo test               # Run Rust tests

# Web packages (nested workspace)
cd web
bun install              # Install web dependencies
bun run build            # Build all web packages
bun run test             # Run web tests
bun run lint             # Lint web packages
```

**Build Order**: The frontend must be built before the Rust binary (static files are embedded):
1. `cd packages/multiplexer/web/frontend && bun run build`
2. `cd packages/multiplexer && cargo build`

**Nested Workspace Exception**: The web packages (`packages/multiplexer/web/*`) use standalone ESLint configs instead of `@shepherdjerred/eslint-config` due to Bun workspace resolution limitations with deeply nested packages. These configs follow the same patterns and rules as the shared config.
