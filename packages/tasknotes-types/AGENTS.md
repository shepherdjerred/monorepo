# TaskNotes Types

Shared Zod schemas and TypeScript types for the TaskNotes ecosystem. Used by both `tasknotes-server` and `tasks-for-obsidian`.

## NOT a workspace member

This package has its own `node_modules` — always `cd packages/tasknotes-types` before running commands.

## Quick Reference

```bash
bun install                          # Install deps
bun run typecheck                    # Type check
bunx eslint . --max-warnings=0       # Lint
```

## Architecture

Source-only package (no build step). Consumers import TypeScript directly.

- `src/schemas.ts` — All Zod schemas + `z.infer` derived types
- `src/index.ts` — Re-exports everything from schemas

## Design Decisions

- Zod schemas are the single source of truth; types derived via `z.infer`
- Field names match the upstream TaskNotes HTTP API (`details` not `description`)
- `TaskStats` matches upstream shape: `{ total, completed, active, overdue, archived, withTimeTracking }`
- No `.passthrough()` on schemas to keep types clean for strict tsconfig consumers
- Both `TaskQueryFilter` (flat) and `FilterQuery` (upstream tree format) included
