---
date: 2026-06-13
slug: check-todos-ripgrep-ci-fix
---

## Status

Complete

## Context

PR #1156 (`feature/code-quality-ci-parity`) added `check-todos` as a Dagger CI
gate. The gate immediately failed with:

```
[stale-source-marker-claim] packages/docs/todos/mario-kart-web-auth.md:
  declares 'source_marker: true' but no matching TODO(todo:mario-kart-web-auth) found in source
```

The todo doc correctly has `source_marker: true` — the marker
`TODO(todo:mario-kart-web-auth)` does exist at
`packages/discord-plays-mario-kart/packages/backend/src/webserver/dispatch.ts:75`
and `bun scripts/check-todos.ts` exits 0 locally.

## Root Cause

`check-todos.ts` uses `rg` (ripgrep) to scan source markers. The `oven/bun`
Debian base image used by `bunQualityBase()` does not ship `ripgrep`. When a
command is not found, Bun's `$` shell returns **exit code 1** (not 127), which
is the same exit code ripgrep uses for "no matches found". The code treats exit
code 1 as "no markers exist", returns an empty marker list, and then the
stale-source-marker-claim validation fires for every doc with
`source_marker: true`.

## Fix

Added `apt-get install ripgrep` to `checkTodosHelper` in
`.dagger/src/quality.ts`, following the same pattern used by
`lineEndingsCheckHelper` (which installs `git` for the same reason — the base
image doesn't ship it).

The `mario-kart-web-auth.md` doc is correct and unchanged: the marker is real,
`source_marker: true` is accurate.

## Session Log — 2026-06-13

### Done

- Identified root cause: Bun `$` returns exit code 1 for "command not found",
  same as ripgrep's "no matches" — silently emptying the marker scan in CI.
- Fixed `.dagger/src/quality.ts` `checkTodosHelper` to install `ripgrep` via
  apt-get before running the check.
- Verified `bun scripts/check-todos.ts` exits 0 locally (1 source marker,
  12 docs, all OK).
- Verified `bun scripts/check-dagger-hygiene.ts` reports no violations.

### Remaining

- CI build #3928 will need a new push to trigger a re-run.

### Caveats

- Any other `check-todos.ts`-using context without `rg` would silently misreport
  stale-source-marker-claim. The fix makes CI fail-fast correctly.
