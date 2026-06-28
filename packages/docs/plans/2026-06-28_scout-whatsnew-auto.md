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
unchanged weekly refreshes); the entry references the **real player-facing patch
number from Riot** (e.g. `26.13`) — _not_ the Data Dragon version (`16.13`) — and
links straight to the official patch notes.

## What shipped

**Shared builder** — `frontend/src/data/changelog-builder.tsx` (+ `changelog.tsx`)

- Added `buildChangelogEntry({ date, banner, sections, link? })` → `ChangelogEntry`,
  plus `ChangelogColor` and an optional `link` rendered as an external anchor below
  the sections. Both bots and humans use it; existing rich-JSX entries untouched.
  Throws on a malformed date / empty sections (fail fast). Split into
  `changelog-builder.tsx` (types/component/builder) so `changelog.tsx` (the data
  array) stays under the 500-line cap.
- **Backfilled** a real **Patch 26.13** entry (new champion Locke, balance/item/
  Arena changes) with a direct link to Riot's notes.

**Patch path (programmatic, minor-only, real Riot patch)**

- `data/scripts/riot-patch.ts` (new): `fetchPatches()` GETs Riot's patch-notes
  index and `parsePatchesFromHtml()` reads the server-rendered `__NEXT_DATA__`
  JSON → `{ patch: "26.13", url, tagline, … }`. A plain `fetch()` works (no
  headless browser), so it runs from the Temporal worker. `selectPatchByMinor()`
  matches the Riot patch to the Data Dragon minor (the major differs: 16 ↔ 26).
- `data/scripts/update-changelog.ts` (new, pure + unit-tested): `minorVersionKey`,
  `isMinorVersionBump`, `insertChangelogEntry`, and `buildPatchChangelogEntryLiteral`
  — which now takes a `RiotPatch` and emits the real patch number + a
  "Read Riot's full Patch X.Y notes →" link.
- `data/scripts/update-data-dragon.ts`: capture the on-disk version before
  overwrite; on a minor bump, fetch the matching Riot patch, prepend the entry to
  `changelog.tsx`, and `bunx prettier --write` it (the prettier gate covers it,
  and this PR auto-merges). Network/parse failure throws; a not-yet-posted matching
  patch is an expected timing case that skips the entry without blocking the asset PR.
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

| File                                                                                | Change                                                       |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `…/frontend/src/data/changelog-builder.tsx`                                         | **new** types/component/`buildChangelogEntry` (+ link)       |
| `…/frontend/src/data/changelog.tsx`                                                 | slimmed to data array; backfilled real **Patch 26.13** entry |
| `…/data/scripts/riot-patch.ts` (+ test)                                             | **new** fetch + parse Riot patch notes; select by minor      |
| `…/data/scripts/update-changelog.ts` (+ test)                                       | **new** pure helpers; entry uses real patch + link           |
| `…/data/scripts/update-data-dragon.ts`                                              | minor-bump gate → resolve Riot patch → insert + prettier     |
| `…/temporal/src/activities/data-dragon.ts`                                          | changelog in `GENERATED_PATHS`                               |
| `…/temporal/src/activities/scout-season-refresh.ts`                                 | changelog in `SEASON_PATHS` + prettier                       |
| `…/temporal/src/activities/scout-season-refresh-prompt.ts` (+ test, + `-claude.ts`) | prompt + threading                                           |

## Verification (done locally)

- `bun test` → 26 data tests (riot-patch + update-changelog) + 9 prompt tests pass.
- Typecheck clean: data, frontend (`astro check`, 0 errors), temporal. ESLint +
  prettier clean on all changed files; `changelog.tsx` back under the 500-line cap.
- **Live**: `fetchPatches()` against Riot returns `26.13` and `selectPatchByMinor(…,13)`
  → the real notes URL + tagline; the automation's generated literal carries
  `26.13` + the patch-notes link.
- Built the site and screenshotted `/whatsnew` showing the real **Patch 26.13**
  entry (Locke + balance/item/Arena) with a working "Read Riot's full Patch 26.13
  notes →" link (`.claude/artifacts/whatsnew-patch-26-13.jpg`).

## Session Log — 2026-06-28

### Done

- Both paths + shared `buildChangelogEntry` (with optional link); split builder
  into `changelog-builder.tsx`. New `riot-patch.ts` pulls the real player-facing
  patch number (26.x) from Riot; `update-data-dragon.ts` uses it. Backfilled the
  current **Patch 26.13** entry. 35 tests; season prompt/threading + test updated.
- Verified typecheck/lint/prettier/tests across all touched packages and screenshotted
  the rendered 26.13 entry + link.

### Remaining

- Commit + open PR; attach the `/whatsnew` screenshot.
- Optional richer auto-copy: today's automation entry is one factual data-refresh
  line + the patch link. Summarizing patch _highlights_ (new champion, modes, items)
  accurately would need an LLM step (claude -p WebFetch) — deferred; hand-authored
  entries can already be as rich as the 26.13 backfill.

### Caveats

- **Data Dragon version ≠ patch number.** DDragon `16.x` ↔ Riot patch `26.x` (same
  minor, +10 major). Always source the player-facing number from Riot, never the
  DDragon version. If Riot hasn't posted the matching minor yet, the entry is skipped
  (assets still update); a Riot network/parse failure throws.
- Fresh-worktree gap (pre-existing, not from this change): `@shepherdjerred/llm-models`
  isn't in `setup.ts` shared builds, so its `dist` is missing from `file:` copies
  and dependents fail typecheck until built + copies refreshed. Worked around locally.
- Patch entries ride the **auto-merged** PR, so the minor-only gate is load-bearing.
- Season prettier step assumes Claude ran `bun install`; the explicit
  `--frozen-lockfile` install before prettier covers the no-install case.
