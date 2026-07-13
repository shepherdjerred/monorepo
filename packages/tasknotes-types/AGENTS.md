# TaskNotes Types

Shared Zod schemas and TypeScript types for the TaskNotes ecosystem. Used by both `tasknotes-server` and `tasks-for-obsidian`.

Exposes ONLY the `/v2` contract — the upstream TaskNotes plugin HTTP API
(`@tasknotes/model` shapes + zod-v4 wire mirrors). The interim legacy
camelCase surface was removed in P6; the app now owns its internal camelCase
vocabulary in `tasks-for-obsidian/src/domain/base-schemas.ts` and transforms
`/v2` → camelCase at its wire boundary (`src/domain/wire.ts`).

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

- `src/v2.ts` — The `/v2` contract: re-exports `@tasknotes/model` plus zod-v4
  wire mirrors of its schemas, request/response envelopes, and wikilink helpers
- `src/v2.test.ts` — Pins the wire mirrors key-for-key against the model's
  schemas so drift fails loudly
- `src/index.ts` — `export * from "./v2.ts"` (the `.` entry resolves to v2)

Both `.` and `./v2` package exports resolve to the v2 contract (`.` via
`index.ts` re-export, `./v2` directly).

## Design Decisions

- Zod schemas are the single source of truth; types derived via `z.infer`
- Field names match the upstream TaskNotes HTTP API (snake_case recurrence
  fields, `details` not `description`)
- The model ships zod v3 (its own bundled copy); the wire schemas are zod-v4
  MIRRORS because v3 and v4 schemas cannot type-compose. `v2.test.ts` guards drift.
