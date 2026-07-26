---
id: docs-board-trash-cleanup-ci
type: log
status: complete
board: false
---

# Main build 6302: docs-board tests depend on the macOS-only `trash` CLI

Fourth leg of the get-main-green session (after
[[images-digest-format-argocd-transient]]). Build 6302 failed in
`turborepo-verify`: every `@shepherdjerred/docs-board` DocumentStore test
errored with `Executable not found in $PATH: "trash"`.

## Root cause — latent since #1573, unmasked by a cache invalidation

`document-store.test.ts`'s `afterEach` cleaned up its `/tmp/docs-board-test.*`
fixtures with the `trash` CLI — a macOS-only tool absent from the Linux CI
image. The suite has been broken in CI since it landed (#1573), but turbo
always replayed it from cache (the run that seeded the cache predates the
suite or ran where `trash` existed). PR #1670's `scripts/lib/transient.ts`
change invalidated that cache and forced the suite's first real CI run,
surfacing the failure. Nothing in #1670 is at fault — the same unmasking
awaited any input change.

## Fix

Replace the `trash` invocation with `rm` from `node:fs/promises`
(`{ recursive: true, force: true }`). The existing path guard
(`root.includes("/docs-board-test.")`, thrown otherwise) already scopes
deletion to this suite's own `mktemp` fixtures, so trash-instead-of-delete
adds no safety here and costs CI portability.

Verified: `bunx turbo run test lint typecheck --filter=@shepherdjerred/docs-board`
green locally; `bun run verify -- --affected` via pre-commit.

## Session Log — 2026-07-25

### Done

- Diagnosed 6302's verify failure (latent `trash` dependency in docs-board
  tests, unmasked by turbo cache invalidation) and fixed the cleanup to use
  portable `fs.rm` (worktree `fix/docs-board-portable-cleanup`).

### Remaining

- Merge, then watch the next main build — with verify unblocked it should
  finally run the whole chain (images → sites → scout tag mint → argocd →
  commit-back) to green.

### Caveats

- Turbo's test cache can mask environment-dependent test failures until an
  unrelated input change forces a re-run; treat "first real run" failures
  after infra merges as potentially latent, not caused by the triggering PR.
