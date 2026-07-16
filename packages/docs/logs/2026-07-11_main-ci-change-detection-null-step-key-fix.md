# Main CI broken: change-detection Zod schema rejected Buildkite API nulls

## Status

Complete

## Problem

Every main build since PR #1438 (`72b31c3c7`, merged 2026-07-11 11:45) failed at
`:pipeline: Generate Pipeline` with:

> No qualifying successful main build found in last 0 builds (1 pages); cannot
> scope this build safely.

## Root cause

PR #1438 replaced the hand-rolled Buildkite API parser in
`scripts/ci/src/change-detection.ts` with strict Zod schemas. The old parser
copied fields only when `typeof value === "string"`, silently tolerating nulls.
The new schema used `z.string().optional()`, which rejects `null` — but the
Buildkite REST API returns explicit `step_key: null` on every keyless job
(including the bootstrap `:pipeline: Upload pipeline` job present in every
build). Verified against the live API: all 100 builds on page 1 failed parsing
with `jobs.step_key: Invalid input: expected string, received null`.

`parseBuildkiteBuilds` silently dropped parse failures, so the generator saw an
empty page, stopped paginating (`0 < per_page`), concluded no green base build
existed, and threw. The silent drop made a 100% parse failure indistinguishable
from "no builds found".

## Fix

- Made all schema fields null-tolerant via
  `z.preprocess(nullToUndefined, z.string().optional())` (preprocess rather
  than `.transform()` so inferred object keys stay optional — `.nullish().transform()`
  makes output keys required and broke test literals).
- Made schema drift loud: `parseBuildkiteBuilds` now throws if a non-empty API
  page yields zero parseable builds, and logs a warning on partial parse
  failures. Non-array responses throw a `TypeError`.
- Regression tests: null `step_key`/`name`/`command` builds qualify; total
  parse failure throws "refusing to treat schema drift as empty history".

## Verification

- `bun test` (315 pass), `bun run typecheck`, `bun run lint` (0 errors) in `scripts/ci`.
- Replayed the real API page-1 payload through `_getLastSuccessfulCommit` with a
  mock fetch: resolves base build #5198, commit `16e0c1f26d`.
- Recovery needs no `LAST_SUCCESSFUL_COMMIT_OVERRIDE`: the generator runs from
  the incoming commit's code, and the last green build (#5198) is on page 1 of
  the lookback.

## Session Log — 2026-07-11

### Done

- Diagnosed main CI failure streak (builds ~5199–5345) to the Zod schema in
  `scripts/ci/src/change-detection.ts` rejecting `step_key: null`.
- Fixed schema null-tolerance + loud schema-drift failure; added 2 regression
  tests; pushed directly to main.

### Remaining

- Confirm the next main build goes green end-to-end (pipeline generation is the
  fixed step; downstream steps should behave as before #1438).

### Caveats

- Only `step_key` was observed null in the sampled 100 builds, but `name`/
  `command` are documented-null on waiter/trigger jobs, so all fields were made
  null-tolerant.
- The 19 pre-existing ESLint warnings in `scripts/ci` remain (warnings, not
  errors; untouched by this fix).
