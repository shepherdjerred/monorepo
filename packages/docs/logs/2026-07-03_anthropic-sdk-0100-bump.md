---
date: 2026-07-03
slug: anthropic-sdk-0100-bump
pr: "1368"
---

# PR #1368: @anthropic-ai/sdk bump to v0.100.1

## Status

In Progress

## Context

Renovate PR to bump `@anthropic-ai/sdk` from `^0.96.0` to `^0.100.1` across
`packages/temporal`, `packages/llm-observability`, and `packages/monarch`.

## Issues Found and Fixed

### 1. `bun.lock` drift in `discord-plays-pokemon` and `scout-for-lol`

Both packages depend on `llm-observability` via `file:` links. The SDK bump in
`llm-observability` caused their per-package lockfiles to drift (the reverse
`file:`-dep closure). The `bun-lock-drift-check` CI gate caught this.

Fix: regenerated both lockfiles with `bun install` and committed.

- `packages/discord-plays-pokemon/bun.lock`
- `packages/scout-for-lol/bun.lock`

### 2. `Usage.output_tokens_details` required field in SDK v0.100.1

`@anthropic-ai/sdk` v0.100.1 added `output_tokens_details: OutputTokensDetails | null`
as a required field on the `Usage` interface. The test stub in
`packages/temporal/src/activities/pr-review/summary.test.ts` was missing it,
causing a TypeScript error.

Fix: added `output_tokens_details: null` to the stub object.

## Session Log — 2026-07-03

### Done

- Diagnosed `bun-lock-drift-check` CI failure: `discord-plays-pokemon` and `scout-for-lol` bun.lock files were stale
- Regenerated `packages/discord-plays-pokemon/bun.lock` and `packages/scout-for-lol/bun.lock`
- Commit `88eed2b63`: lockfile fix
- Diagnosed TypeScript error: `output_tokens_details` missing from `Usage` stub in `summary.test.ts`
- Fixed `packages/temporal/src/activities/pr-review/summary.test.ts:47` to add `output_tokens_details: null`
- Commit `e1e984b39`: typecheck fix
- Pushed both commits; CI build #4828 scheduled

### Remaining

- CI build #4829 in progress — waiting for all HARD checks to pass

### Caveats

- Renovate posted a warning that it will no longer auto-rebase since a non-Renovate author made commits. This is expected and acceptable.
- `@anthropic-ai/sdk/resources/messages` is now a directory in v0.100.1 (previously a flat file). The existing import paths still work because `resources/messages.d.ts` now just re-exports from `resources/messages/index.d.ts`.
- SDK v0.100.1 also introduced a `messages/messages.d.ts` sub-file for the actual type definitions — the chain is flat→directory→messages.d.ts.
- Build #4828 was triggered during peak runner congestion (PRs #1372-1376 all competing simultaneously). The `pipeline-generate-pipeline` step started after ~1.5h queue delay and passed, but sub-steps never appeared in GitHub — likely the generated steps remained permanently queued. A new build was triggered to resolve this.
