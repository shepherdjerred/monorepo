# Auto-update Scout "What's New" on new patches & seasons

## Status

In Progress (implemented + verified locally; PR pending)

## Context

Scout's two Temporal automations keep game data current but never touched the
marketing "What's New" changelog, so newly supported patches/seasons landed
silently:

- **Data Dragon** (`scout-data-dragon-version-check` / `-weekly-refresh`) — programmatic, auto-merges. Bumps `version.json` + assets on a new patch.
- **Season Refresh** (`scout-season-refresh-weekly`) — `claude -p`, human-reviewed. Adds/adjusts seasons in `seasons.ts`.

Goal: append a "What's New" entry **in the same PR** each automation already
opens. Per owner decision: cover **both** triggers; patches add an entry **only
on minor-version bumps** (`16.13.x → 16.14.x`, never hotfix micro-bumps or
unchanged weekly refreshes); patch copy is templated, season copy is
Claude-written.

## What shipped

**Shared builder** — `packages/scout-for-lol/packages/frontend/src/data/changelog.tsx`

- Exported `ColorScheme` (+ `ChangelogColor` alias) and added
  `buildChangelogEntry({ date, banner, sections })` → `ChangelogEntry`. Both bots
  and humans use it; existing rich-JSX entries untouched. Throws on a malformed
  date / empty sections (fail fast).

**Patch path (programmatic, minor-only)**

- `packages/scout-for-lol/packages/data/scripts/update-changelog.ts` (new, pure +
  unit-tested): `minorVersionKey`, `isMinorVersionBump`, `formatDateForChangelog`,
  `buildChangelogEntryLiteral`, `insertChangelogEntry`, `buildPatchChangelogEntryLiteral`.
- `…/data/scripts/update-data-dragon.ts`: capture the on-disk version before
  overwrite; after assets+snapshots, on a minor bump prepend a templated entry to
  `changelog.tsx` and run `bunx prettier --write` (the prettier gate covers it,
  and this PR auto-merges).
- `packages/temporal/src/activities/data-dragon.ts`: added the changelog path to
  `GENERATED_PATHS` so it commits with the PR (a `git add` of an unchanged path
  is a no-op).

**Season path (Claude-written, new-season-only)**

- `…/scout-season-refresh.ts`: added `CHANGELOG_FILE` to `SEASON_PATHS` (wires
  staging + change-detection + diff); when the changelog actually changed, run
  `bun install --frozen-lockfile` + `bunx prettier --write` before opening the PR.
- `…/scout-season-refresh-prompt.ts` (+ `-claude.ts` threading): instruct Claude
  to prepend a `buildChangelogEntry({...})` entry **only when adding a brand-new
  season/act ID**; widened the "never modify outside" rule to permit the changelog.

## Files

| File                                                                                | Change                                                           |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `…/frontend/src/data/changelog.tsx`                                                 | export `ColorScheme`/`ChangelogColor`; add `buildChangelogEntry` |
| `…/data/scripts/update-changelog.ts`                                                | **new** pure helpers                                             |
| `…/data/scripts/update-changelog.test.ts`                                           | **new** 15 unit tests                                            |
| `…/data/scripts/update-data-dragon.ts`                                              | minor-bump gate → insert entry + prettier                        |
| `…/temporal/src/activities/data-dragon.ts`                                          | changelog in `GENERATED_PATHS`                                   |
| `…/temporal/src/activities/scout-season-refresh.ts`                                 | changelog in `SEASON_PATHS` + prettier                           |
| `…/temporal/src/activities/scout-season-refresh-prompt.ts` (+ test, + `-claude.ts`) | prompt + threading                                               |

## Verification (done locally)

- `bun test scripts/update-changelog.test.ts` → 15 pass; prompt test → 9 pass.
- Typecheck clean: data, frontend (`astro check`, 0 errors), temporal.
- ESLint clean on changed files; prettier clean on all changed files.
- Inserted a sample patch entry into the real `changelog.tsx` → `astro check`
  0 errors → built the site → screenshotted `/whatsnew` showing the
  auto-generated "June 28, 2026 / Game Data / …League patch 16.14" entry rendering
  identically to hand-authored entries. Sample reverted.

## Session Log — 2026-06-28

### Done

- Implemented both paths + shared `buildChangelogEntry`; new `update-changelog.ts`
  - 15 tests; updated season prompt/threading + prompt test.
- Verified typecheck/lint/prettier/tests across the three touched packages and
  proved an auto-entry renders on `/whatsnew` (screenshot at
  `.claude/artifacts/whatsnew-patch-entry.jpg`).

### Remaining

- Commit + open PR; attach the `/whatsnew` screenshot.
- Optional acceptance: observe the first real minor-bump Data Dragon PR and the
  next new-season refresh PR to confirm the entry shows up end-to-end in prod.

### Caveats

- Fresh-worktree gap (pre-existing, not from this change): `@shepherdjerred/llm-models`
  isn't in `setup.ts` shared builds, so its `dist` is missing from `file:` copies
  and dependents (temporal `summary-cost.ts`, scout `review/models.ts`) fail
  typecheck until it's built + copies refreshed. Worked around locally.
- Patch entries ride the **auto-merged** PR, so the minor-only gate is
  load-bearing — keep it strict to avoid shipping changelog spam unreviewed.
- Season prettier step assumes Claude ran `bun install` to run tests; the explicit
  `--frozen-lockfile` install before prettier covers the no-install case.
