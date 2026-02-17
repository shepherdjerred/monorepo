# CLAUDE.md

Bun workspaces monorepo. Use `bun` commands exclusively (never npm/yarn/pnpm).

## Structure

```
packages/
├── birmel/        # Discord bot (Mastra + Claude AI)
├── eslint-config/ # Shared ESLint rules
├── dagger-utils/  # Dagger CI/CD utilities
├── a2ui-poc/      # Hono backend + React/Vite frontend
├── claude-plugin/ # Claude Code plugin
├── clauderon/     # Rust session manager (has its own CLAUDE.md)
.dagger/           # CI/CD pipeline
archive/           # Legacy projects (do not modify)
```

## Commands

```bash
# Root commands
bun run build|test|typecheck

# Package-specific
bun run --filter='./packages/<name>' <script>

# Linting (per-package)
cd packages/<name> && bunx eslint . --fix

# CI (Dagger)
dagger call ci
```

## Development Setup

```bash
mise trust && mise dev   # Installs bun + dagger
```

## Verification

Always verify changes:

1. `bun run typecheck` - Type errors
2. `bun run test` - Test failures
3. `bunx eslint . --fix` - Lint issues (in relevant package)

## Package Notes

Each package has its own CLAUDE.md with specific instructions:

- `packages/clauderon/CLAUDE.md` - Rust build order, backends, architecture
- `packages/birmel/CLAUDE.md` - Prisma setup, Mastra studio
- `packages/a2ui-poc/CLAUDE.md` - Dev server commands
- `packages/eslint-config/CLAUDE.md` - Custom rules reference
