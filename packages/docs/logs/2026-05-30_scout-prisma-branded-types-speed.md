---
id: log-2026-05-30-scout-prisma-branded-types-speed
type: log
status: complete
board: false
---

# Scout Prisma Branded Types Speedup

## Summary

Replaced `packages/scout-for-lol/packages/backend/scripts/brand-prisma-types.ts`
with a deterministic text transformer. Prisma 7.8 still generates primitive
TypeScript field types for `Int` and `String` schema fields; it does not provide
a schema-level branded/custom TypeScript scalar mapping that would remove the
need for this post-generation step.

The old `ts-morph` implementation took 127.64s to brand a raw 62k-line
generated `index.d.ts` in the benchmark. The replacement transforms the same
1,293 properties in about 0.06-0.08s.

## Session Log — 2026-05-30

### Done

- Checked current Prisma docs for generated type behavior and generator
  capabilities.
- Benchmarked the old `ts-morph` branding script against a raw generated Scout
  Prisma client: 127.64s.
- Rewrote
  `packages/scout-for-lol/packages/backend/scripts/brand-prisma-types.ts` to use
  a text pass over generated declaration blocks.
- Verified the new script transforms the same 1,293 branded properties and runs
  in about 0.06-0.08s.
- Compared old and new generated `index.d.ts` output. The raw pre-Prettier
  files differ only in formatting, and the post-Prettier files are byte-for-byte
  identical.
- Added `packages/scout-for-lol/packages/backend/scripts/brand-prisma-types.test.ts`
  with accuracy coverage for payloads, inputs, aggregates, field refs, payload
  reference instantiation, filesystem output, and a large-fixture speed budget.
- Ran `bun run db:generate` in
  `packages/scout-for-lol/packages/backend`.
- Ran `bunx eslint scripts/brand-prisma-types.ts --no-ignore`.
- Ran
  `bunx eslint scripts/brand-prisma-types.ts scripts/brand-prisma-types.test.ts --fix --no-ignore`.
- Ran `bun run typecheck` in
  `packages/scout-for-lol/packages/backend`.
- Ran `bun test scripts/brand-prisma-types.test.ts`.
- Ran `bun test scripts/branded-types.test.ts`.

### Remaining

- None.

### Caveats

- `scripts/branded-types.test.ts` is compile-time only, so Bun reports 0 runtime
  tests; `bun run typecheck` is the meaningful assertion for that file.

## Session Log — 2026-05-31

### Done

- Opened PR #992 for branch `codex/scout-prisma-brand-tests`.
- Monitored Buildkite build #3087 to completion; all hard checks passed, with
  only a soft-failed Trivy scan.
- Addressed a Greptile P2 by making
  `packages/scout-for-lol/packages/backend/scripts/brand-prisma-types.ts`
  collect branded imports in per-call transform state instead of module-level
  mutable state.
- Added a regression assertion to
  `packages/scout-for-lol/packages/backend/scripts/brand-prisma-types.test.ts`
  proving imports do not leak between text transform calls.
- Ran
  `bunx eslint scripts/brand-prisma-types.ts scripts/brand-prisma-types.test.ts --fix --no-ignore`.
- Ran `bun test scripts/brand-prisma-types.test.ts`.
- Ran `bun run typecheck` in
  `packages/scout-for-lol/packages/backend`.
- Pushed follow-up commit `d120e099f` and rechecked PR #992; Buildkite build
  #3094 passed all hard checks.

### Remaining

- None.

### Caveats

- Buildkite soft failures are intentionally ignored for this PR-readiness loop.
