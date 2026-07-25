---
id: plan-2026-06-28-scout-whatsnew-auto
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Auto-update Scout "What's New" on new patches & seasons

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
- `data/scripts/patch-highlights.ts` (new, + test): `generatePatchHighlights()`
  spawns `claude -p` (Haiku, WebFetch-only, 2-min timeout) to read the real patch
  notes and return 2-4 player-facing highlight bullets; the prompt + JSON parser
  are pure/tested. Best-effort — a failure falls back to the data-refresh line only.
- `data/scripts/update-changelog.ts` (new, pure + unit-tested): `minorVersionKey`,
  `isMinorVersionBump`, `insertChangelogEntry`, and
  `buildPatchChangelogEntryLiteral(patch, highlights, date)` — emits the real patch
  number, the data-refresh line + Claude highlights, and a
  "Read Riot's full Patch X.Y notes →" link. The deterministic code owns the
  number/link/gating, so the LLM can't get the load-bearing facts wrong.
- `data/scripts/update-data-dragon.ts`: capture the on-disk version before
  overwrite; on a minor bump, fetch the matching Riot patch, ask Claude for
  highlights, prepend the entry to `changelog.tsx`, and `bunx prettier --write` it
  (the prettier gate covers it, and this PR auto-merges). Riot network/parse failure
  throws; a not-yet-posted matching patch skips the entry without blocking the asset PR.
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
| `…/data/scripts/patch-highlights.ts` (+ test)                                       | **new** `claude -p` summarizes notes → highlight bullets     |
| `…/data/scripts/update-changelog.ts` (+ test)                                       | **new** pure helpers; entry = real patch + highlights + link |
| `…/data/scripts/update-data-dragon.ts`                                              | minor-bump gate → Riot patch → Claude highlights → insert    |
| `…/temporal/src/activities/data-dragon.ts`                                          | changelog in `GENERATED_PATHS`                               |
| `…/temporal/src/activities/scout-season-refresh.ts`                                 | changelog in `SEASON_PATHS` + prettier                       |
| `…/temporal/src/activities/scout-season-refresh-prompt.ts` (+ test, + `-claude.ts`) | prompt + threading                                           |

## Verification (done locally)

- `bun test scripts/` → 38 data tests (riot-patch + patch-highlights +
  update-changelog) pass; season prompt test → 9 pass.
- Typecheck clean: data, frontend (`astro check`, 0 errors), temporal. ESLint +
  prettier clean on all changed files; `changelog.tsx` back under the 500-line cap.
- **Live end-to-end**: `fetchPatches()` returns `26.13`; `generatePatchHighlights()`
  (real `claude -p`) returned accurate bullets — "New champion Locke, the Ashen
  Exorcist…", "Ranked 5v5 returns… with Tournament Draft", "buffs to Aphelios/
  Draven/Kai'Sa; nerfs to Bard/Brand/Cassiopeia".
- Built the site and screenshotted `/whatsnew` showing the real **Patch 26.13**
  entry with the Claude highlights + a working "Read Riot's full Patch 26.13 notes →"
  link (`.claude/artifacts/whatsnew-patch-26-13-llm.jpg`).

## Session Log — 2026-06-28

### Done

- Both paths + shared `buildChangelogEntry` (with optional link); split builder
  into `changelog-builder.tsx`. `riot-patch.ts` pulls the real player-facing patch
  number (26.x) from Riot; `patch-highlights.ts` has `claude -p` summarize the notes
  into highlight bullets; `update-data-dragon.ts` wires both. Backfilled the current
  **Patch 26.13** entry with the real Claude highlights + link. 47 tests total.
- Verified typecheck/lint/prettier/tests across all touched packages; live-ran the
  LLM highlight generation; screenshotted the rendered 26.13 entry + link.

### Remaining

- Commit + open PR; attach the `/whatsnew` screenshot.
- Acceptance: watch the first real minor-bump Data Dragon PR to confirm the
  Claude-highlight entry lands end-to-end (and the season PR for a new act).

### Caveats

- **Data Dragon version ≠ patch number.** DDragon `16.x` ↔ Riot patch `26.x` (same
  minor, +10 major). Always source the player-facing number from Riot, never the
  DDragon version. If Riot hasn't posted the matching minor yet, the entry is skipped
  (assets still update); a Riot network/parse failure throws.
- Fresh-worktree gap (pre-existing, not from this change): `@shepherdjerred/llm-models`
  isn't in `setup.ts` shared builds, so its `dist` is missing from `file:` copies
  and dependents fail typecheck until built + copies refreshed. Worked around locally.
- Patch entries ride the **auto-merged** PR, so the minor-only gate is load-bearing.
- Patch highlights need the `claude` CLI + `CLAUDE_CODE_OAUTH_TOKEN` on `PATH` in
  the worker (already present for season-refresh / pr-agent). It's **best-effort**:
  if Claude is missing/fails, the entry still ships with the data-refresh line + link.
  Highlights are LLM-generated and auto-merged, so they're unreviewed — kept short,
  WebFetch-only, and strictly-factual by the prompt; the deterministic patch number
  and link are never LLM-controlled.
- Season prettier step assumes Claude ran `bun install`; the explicit
  `--frozen-lockfile` install before prettier covers the no-install case.

## Remaining

- [ ] Complete and verify the work described in `Auto-update Scout "What's New" on new patches & seasons`.
