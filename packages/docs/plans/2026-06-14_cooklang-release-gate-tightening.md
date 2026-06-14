# Tighten the cooklang plugin-release gate

## Status

In Progress

## Context

After PR #1038 added a "real source change" gate for the cooklang plugin release, the gate is still too loose: it considers any file under `packages/cooklang-for-obsidian/` or `packages/cooklang-rich-preview/` to be plugin source, with only `manifest.json` / `versions.json` excluded.

Two recurring false triggers slipped through and now drive perpetual `chore(cooklang): bump plugin manifest version` PRs (e.g. PR #1210 — 10 commits over 18h):

1. **`_summary.md`** — auto-rewritten weekly in every package by `cog -r` via the `readme-refresh-weekly` Temporal schedule (`packages/temporal/src/activities/readme-refresh.ts:14,30`). PR #1164 introduced this; every Monday 08:00 PT it'll re-trip the gate.
2. **`packages/cooklang-rich-preview/`** — this is the rich-preview _Astro site_, not the plugin. Only `packages/cooklang-for-obsidian/` is actually packaged and released (`.dagger/src/release.ts:710,765`). Lockfile bumps and unrelated edits to the site shouldn't cut a plugin release.

Each false trigger fires `cooklangPublishHelper` → `cooklangVersionCommitBackHelper`, which force-pushes the pending branch with another patch bump and re-opens / refreshes the PR.

**Outcome wanted:** the plugin-release gate fires only on changes that actually affect the shipped plugin artifact.

## Approach

Two surgical edits in `scripts/ci/src/change-detection.ts`:

1. **Drop `cooklang-rich-preview/` from `COOKLANG_PACKAGE_PREFIXES`** — rich-preview is the site, not the plugin.
2. **Split the exclusion sets** so `hasCooklangSourceChange` ignores cog-generated docs without polluting the commit-back fast-track:
   - Keep `COOKLANG_VERSION_COMMIT_BACK_FILES` as-is (`manifest.json`, `versions.json`) — `isCooklangVersionCommitBackOnly` should still mean "only commit-back artifacts changed".
   - Add a new `COOKLANG_NON_SOURCE_FILES` set used by `hasCooklangSourceChange`. Contents:
     - All entries from `COOKLANG_VERSION_COMMIT_BACK_FILES`
     - `packages/cooklang-for-obsidian/_summary.md`

Keep the prefix-based check otherwise intact — i.e. any new top-level file in `cooklang-for-obsidian/` still defaults to triggering a release. That preserves the existing safe-by-default behaviour for genuine source (`src/**`, `styles.css`, `esbuild.config.mjs`, `package.json` dep bumps, etc., per existing tests).

## Files to modify

- `scripts/ci/src/change-detection.ts:33-42,85-91` — drop rich-preview prefix; add `COOKLANG_NON_SOURCE_FILES`; have `hasCooklangSourceChange` consult the new set; leave `isCooklangVersionCommitBackOnly` keyed off the original set.
- `scripts/ci/src/__tests__/change-detection.test.ts:315-378` — update test coverage:
  - Flip line 331's "returns true for cooklang-rich-preview source" to assert **false** (it's now out-of-scope).
  - Add a case: only `packages/cooklang-for-obsidian/_summary.md` changed → `false`.
  - Add a case: `_summary.md` + a real source file → `true` (source still wins).
  - Sanity-check existing positive cases (`src/main.ts`, `package.json + bun.lock`) still pass.

No changes needed in `.dagger/src/release.ts` or `pipeline-builder.ts` — they already read off `affected.cooklangChanged`.

## Verification

1. `cd scripts/ci && bun test src/__tests__/change-detection.test.ts` — new + updated assertions pass.
2. `cd scripts/ci && bun test` — pipeline-builder tests still green (the `cooklangChanged: true/false` fixtures don't depend on the prefix list).
3. Spot-check by re-running change detection against the two known-bad commits:
   - `d2de32` (PR #1164, README refresh — touched both `_summary.md`s) → expect `cooklangSourceChanged=false`.
   - `7a4ac9` (PR #1151, strict CI checks — touched `cooklang-rich-preview/bun.lock` + `package.json`) → expect `cooklangSourceChanged=false`.
     Quickest way: a throwaway `bun -e` that imports `_hasCooklangSourceChange` and asserts on the file lists from those two commits.
4. After merge: confirm next Monday's `readme-refresh-weekly` run does **not** open a fresh cooklang bump PR. (PR #1210 itself should still be merged or closed first — the gate fix won't retroactively clean it up.)

## Out of scope

- Cleaning up the **published** plugin versions on the external repo — the `cooklang-for-obsidian` release repo will retain v1.0.22–v1.0.32; no harm leaving them.
- Tightening `cooklang-for-obsidian/` further (allow-list of build inputs only). Skip until we see another false trigger; the current prefix-based check matches the existing tests' expectations for `package.json` dep bumps.
