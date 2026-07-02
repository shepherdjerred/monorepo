# PR #1353: LLM Catalog Refresh Fixes

## Status

Complete

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
