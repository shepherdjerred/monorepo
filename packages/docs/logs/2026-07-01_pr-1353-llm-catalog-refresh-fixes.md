---
id: log-2026-07-01-pr-1353-llm-catalog-refresh-fixes
type: log
status: complete
board: false
---

# PR #1353: LLM Catalog Refresh Fixes

## Context

PR #1353 (`chore/llm-catalog-refresh-33ca64b7`) refreshed the LLM model catalog pricing from
upstream datasets. The user identified two problems after the initial merge:

1. `claude-opus-4-8` context window regressed from 1M to 200K
2. Lots of formatting-only churn in the diff (key reordering)

## Root Causes

**Opus context regression**: The upstream community datasets (models.dev and LiteLLM) both
report `claude-opus-4-8` with a 200K context window. The sync script trusted them and blindly
overwrote the catalog's correct 1M value.

**Formatting churn**: `sync-from-upstreams.ts` wrote the updated catalog via:

```ts
JSON.stringify(CatalogSchema.parse(catalog), null, 2);
```

Zod's `parse()` creates a new object with keys in schema-definition order, regardless of the
original JSON key order. So every refresh run re-emitted the entire catalog with Zod's key
ordering — generating a large formatting-only diff even when only one price changed. In this
PR, all four diff hunks were either pure key reordering or the bad Opus context change.

## Fixes Applied (commit 4bb282488)

### `packages/llm-models/src/catalog.json`

- Restored to main's version (reverted all key-reordering churn)
- Added `"pinnedContextWindow": true` to `claude-opus-4-8` — the only substantive diff vs main

### `packages/llm-models/src/index.ts`

- Added `pinnedContextWindow: z.boolean().optional()` to `ModelEntrySchema` with JSDoc

### `packages/llm-models/scripts/sync-from-upstreams.ts`

- In `reconcile()`: skip context-window updates when `entry.pinnedContextWindow` is true
- In `main()`: read raw JSON text separately into `rawCatalog`; after reconcile patches the
  Zod-typed `catalog`, copy only the drifted numeric fields (`input`, `output`, `contextWindow`)
  back into `rawCatalog`, then write `rawCatalog` — preserving all original key ordering

## Session Log — 2026-07-01

### Done

- Identified both root causes (upstream 200K data + Zod key-order churn)
- Restored `catalog.json` to main's key ordering; added `pinnedContextWindow: true` to Opus entry
- Added `pinnedContextWindow` to the Zod schema (`packages/llm-models/src/index.ts`)
- Fixed `sync-from-upstreams.ts` to write raw JSON (not Zod-reparsed), preserving key order
- Fixed `reconcile()` to skip pinned context windows
- All 12 tests pass; all pre-commit hooks pass (prettier, safety, todo checks)
- Committed as `4bb282488` and pushed to `chore/llm-catalog-refresh-33ca64b7`
- Posted explanatory comment on PR #1353: https://github.com/shepherdjerred/monorepo/pull/1353#issuecomment-4861714594

### Remaining

- CI (Buildkite build #4773) was still running at end of session — should complete green
- Greptile will post a new review on the updated commit

### Caveats

- `claude-opus-4-8` is the only model with `pinnedContextWindow: true`. If other models' context
  windows are also wrong in upstream datasets, they'll need the same annotation.
- The write-back loop in `sync-from-upstreams.ts` patches `input` and `output` unconditionally
  for all text models. If upstream ever reports a value we don't want applied (like the context
  window issue), those fields would also need a pinning mechanism.

## Session Log — 2026-07-03

### Done

- Identified root cause of `mag-greptile-review` CI failure: greptile flagged a P1 schema mismatch
  — `pinnedContextWindow` was present in `catalog.json` and the Zod schema but NOT in
  `catalog.schema.json` (which has `additionalProperties: false`) or the Python Pydantic model
  (which has `extra: "forbid"`).
- Fixed `packages/llm-models/catalog.schema.json`: added `"pinnedContextWindow": { "type": "boolean" }` to `modelEntry.properties`.
- Fixed `packages/llm-models/python/validate_catalog.py`: added `pinnedContextWindow: Optional[bool] = None` to `ModelEntry`.
- Verified Python validator passes (`OK: 11 models validated`), all 12 bun tests pass.
- Committed as `fa5616ea3` and pushed to `chore/llm-catalog-refresh-33ca64b7`.

### Remaining

- CI (Buildkite) will re-trigger on the new commit. Greptile should re-review and the P1
  schema mismatch should be resolved. Monitor the next CI run.
- `mag-greptile-review` is a HARD check (not soft_fail) — it must pass for the parent build
  to go green.

### Caveats

- The `greptileReviewStep()` has no `soft_fail` — it's a hard gate. CI will only go green
  once greptile's re-review is clean on the new commit.

## Session Log — 2026-07-03 (pass 7)

### Done

- Canary build triggered after Dagger engine cache PVC was purged and pod restarted.

### Remaining

- Confirm `load workspace` passes and drive to green.

---

## Session Log — 2026-07-03 (pass 6)

### Done

- Verified that `:docker: Build temporal-worker` and `:package::heartbeat: Build + Smoke scout-for-lol`
  both pass on main branch (builds #4883, #4890) — confirming build #4898 failures are infra-only.
- Root cause: `docker-build-temporal-worker` ran first with all Dagger steps CACHED + exit 1 after
  `.withEntrypoint()` (classic Dagger blip). Retries then failed at `load workspace: .` (runner
  infra issue, not code). Two retries both failed — build #4898 blocked.
- Pushed fresh pass-6 commit to trigger build on clean runners.

### Remaining

- Wait for new build to complete with all checks green.

### Caveats

- `docker-build-temporal-worker` is triggered by our `llm-models` dep (via `--dep-names llm-models`
  in the Buildkite step). It's not a code failure — main branch passes these same jobs fine.
- If fresh build also fails these two jobs, it's a persistent infra issue and the team lead should
  be asked whether to keep retrying or gate-merge anyway.

---

## Session Log — 2026-07-03 (pass 5)

### Done

- Discovered second lint rule blocking `sync-from-upstreams.ts`: `custom-rules/no-type-guards`
  bans type guard functions (`value is Type` predicates). Build #4871 failed with:
  `55:1 error Type guard functions are not safe. Use Zod schema validation instead.`
  — the `isRecord()` function added in commit `2baa9199e` triggered it.
- Fixed in commit `8f27e64c7`:
  - Removed `isRecord()` type guard entirely
  - `rawCatalog` initialization: replaced `JSON.parse(rawText) as Record<...>` with
    `UnknownRecord.parse(JSON.parse(rawText))` (existing Zod schema, no assertion)
  - Mutation section: replaced `isRecord()` narrowing + shared-reference mutation with
    `record()` (Zod-backed helper) + write-back pattern (`rawCatalog[id] = rawEntry`)
    so mutations propagate correctly (Zod record parse creates copies, not references)
- Pre-commit hooks passed. Build #4896 scheduled.

### Remaining

- Build #4896 must complete with `dagger-knife-pkg-check` lint clean.

### Caveats

- This repo bans BOTH type assertions (`as X` except `as const`/`as unknown`) AND type guards
  (`function isX(v): v is Type`). Only Zod schema validation or explicit value comparisons are
  permitted for narrowing unknown values. The `record()` helper in `sync-from-upstreams.ts`
  wraps `z.record(z.string(), z.unknown()).safeParse()` — prefer it over new narrowing code.
- When using `record()` for mutation: the Zod-parsed copy must be written back into the parent
  object; mutating the copy in-place without write-back has no effect on the original.

---

## Session Log — 2026-07-03 (pass 4)

### Done

- Diagnosed build #4848 umbrella failure root cause: the initial `dagger-knife-pkg-check` job
  (`019f294a-38a0`) was NOT a flake — it was a real ESLint failure in
  `packages/llm-models/scripts/sync-from-upstreams.ts`:
  - Line 153: `@typescript-eslint/strict-boolean-expressions` — `!entry.pinnedContextWindow`
    (`boolean | undefined`) not explicitly null-safe
  - Line 168: `custom-rules/no-type-assertions` — `JSON.parse(rawText) as Record<...>`
  - Line 227: `custom-rules/no-type-assertions` — `raw["pricing"] as Record<string, unknown>`
- Fixed all three violations in commit `2baa9199e`:
  - Added `isRecord(v)` type guard (type-safe narrowing without object copying)
  - Line 153: `!entry.pinnedContextWindow` → `entry.pinnedContextWindow !== true`
  - Lines 168-176: Replaced `as Record<...>` with `isRecord(rawParsed)` guard + fail-fast throw
  - Lines 228-237: Replaced `as Record<string, unknown>` with `isRecord(rawPricingValue)` guard
- Confirmed Greptile thread `PRRT_kwDOHf4r4c6NxEAz` still `isResolved=True, outdated=False`
- Pre-commit hooks passed; pushed `2baa9199e` → triggered build #4849+

### Remaining

- New build must pass all checks including `dagger-knife-pkg-check` (now lint-clean) and
  `mag-greptile-review` (thread still resolved, Greptile will review new commit).

### Caveats

- The second `dagger-knife-pkg-check` job in build #4848 (`019f294a-38b5`) showed "pass" in
  `gh pr checks` despite the same code having lint errors. This may be due to Dagger caching
  returning a previously-cached passing result for a different package scope. The lint failure
  was deterministic and real — both as reported in the first attempt's log and confirmed by
  examining the code.

---

## Session Log — 2026-07-03 (pass 3)

### Done

- Diagnosed real root cause of continued `mag-greptile-review` failure: `wait-for-greptile.ts`
  checks `isResolved` on each thread via GraphQL — NOT just greptile's summary comment.
  Even though greptile's prose said "5/5 — safe to merge", the inline P1 thread
  (`PRRT_kwDOHf4r4c6NxEAz`) had `isResolved=false`. The script fails fast on unresolved threads.
- Resolved the thread via GraphQL `resolveReviewThread` mutation — confirmed `isResolved=true`.
- Posted reply on thread explaining fix commit `fa5616ea3`.
- Pushed empty commit `b23be71e31` to re-trigger CI — MISTAKE: Greptile's webhook does not
  fire for empty commits (no file diff), so greptile step sat polling for 20 min then timed out.
- Pushing this session log update (real file change) to trigger a new build where Greptile fires.

### Remaining

- Build triggered by this commit must complete with greptile step passing.
- `wait-for-greptile.ts` will find: Greptile check-run present + zero unresolved threads = PASS.

### Caveats

- Avoid `git commit --allow-empty` to re-trigger CI: Greptile needs a real file change to
  fire its webhook and create a check-run. Use any non-empty file change instead.
