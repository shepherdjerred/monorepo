# Unify champion name display across Scout for LoL

## Status: Complete

## Context

A prior audit found champion names displayed inconsistently across Scout for LoL: some surfaces show a proper "Xin Zhao"/"Twisted Fate" style name, others leak the raw Data Dragon asset key ("XinZhao"), Riot's `SCREAMING_SNAKE_CASE` enum name ("TWISTED_FATE"), or even the bare numeric champion ID ("Champion 157"). The user directly spotted two instances (`XinZhao` in post-match reports, `Champion 805` in pre-match) and asked to broaden this into a full audit + fix of every display surface, not just those two.

Root problem: there is no single shared "format this for a human" function. Two purpose-built utilities exist but neither is meant for display, and callers reach for whichever is convenient:

- `normalizeChampionName(name: string)` (`packages/data/src/data-dragon/images.ts`) resolves any-case input to the canonical **Data Dragon asset key** (e.g. `"XinZhao"`, `"Velkoz"`) — for image/file lookups, not display.
- `resolveChampionKey(id)` / `getChampionDisplayName(id)` (`packages/backend/src/utils/champion.ts`) are ID-based and twisted-dependent; `getChampionDisplayName` lacks the `champion.json` fallback that `resolveChampionKey` has, so it produces `Champion 805` for any champion newer than twisted's hardcoded enum (currently caps at 804).
- Several call sites just print `Champion ${id}` or the raw `championName` string directly, with no formatting attempt at all.

**No string-mangling scheme (`startCase`, split-on-underscore, etc.) can produce a correct display name.** Verified against the bundled `champion.json` (173 champions): champion 62's asset key is `MonkeyKing` but the correct display name is `Wukong` — not a spacing problem, a genuinely different string. Several champions have apostrophes that any capital-letter-insertion approach mangles: `Velkoz`→`Vel'Koz`, `Khazix`→`Kha'Zix`, `Kaisa`→`Kai'Sa`, `Chogath`→`Cho'Gath`, `KogMaw`→`Kog'Maw`, `RekSai`→`Rek'Sai`, `KSante`→`K'Sante`, `Belveth`→`Bel'Veth`. Others need punctuation (`DrMundo`→`Dr. Mundo`) or extra words (`Nunu`→`Nunu & Willump`, `Renata`→`Renata Glasc`).

The good news: **`champion.json` already carries the correct display name** in its `name` field, keyed by both numeric `key` and asset-key `id` — Riot ships it pre-formatted, apostrophes and all. No hand-maintained override table is needed beyond the existing `champion-name-overrides.generated.ts` (which handles unrelated Twisted-vs-Data-Dragon asset-key drift, not display names).

## Design: one canonical lookup table, two entry points

A lookup table from the bundled `champion.json`'s `name` field (twisted-free, refreshed automatically by `update-data-dragon` whenever assets update), in `packages/data`, with every display call site pointed at it:

1. **`championDisplayNames` / `championDisplayNamesById`** (module-level, `packages/data/src/data-dragon/images.ts`) — built once from `championList.data`, mapping asset key (lowercased) → `c.name`, and numeric id → `c.name`.
2. **`championNameToDisplayName(name: string): string`** — normalizes with the existing `normalizeChampionName(name)` to get the canonical asset key, then looks it up; falls back to the normalized key itself if unmapped.
3. **`getChampionDisplayNameById(championId: number): string`** — looks up `championDisplayNamesById[championId]`, falling back to `` `Champion${championId}` `` only if the id is entirely absent from `champion.json`. Twisted-free, so it never lags behind newly-released champions — this is what makes "Champion 805" impossible going forward.

`packages/backend/src/utils/champion.ts`'s `getChampionDisplayName(championId)` now delegates to `getChampionDisplayNameById` instead of duplicating twisted-based logic — same exported signature, so existing callers (`searchChampions`, `getAllChampions`, prematch notification, competition commands) were unaffected by the internal swap.

## What shipped

**Data package** (`packages/data/src/data-dragon/images.ts`, `index.ts`):

- Added `championDisplayNames`/`championDisplayNamesById` lookup tables and `championNameToDisplayName`/`getChampionDisplayNameById`, exported publicly.
- Tests in `images.test.ts` pin the table-lookup behavior against apostrophes/renames (`Vel'Koz`, `Kha'Zix`, `Wukong`, `Nunu & Willump`) and the 805/Locke fallback.

**Backend** (`packages/backend/src`):

- `utils/champion.ts`: `getChampionDisplayName(id)` now delegates to `getChampionDisplayNameById` from `@scout-for-lol/data`.
- `discord/embeds/competition-format-helpers.ts`: removed `getChampionNameSafe()` (returned raw `SCREAMING_SNAKE_CASE`), now calls the fixed `getChampionDisplayName`.
- `discord/commands/competition/list.ts` and `view.ts`: replaced `` `Champion ${id}` `` placeholders with `getChampionDisplayName(c.championId)`.
- Updated stale test expectations in `utils/champion.test.ts` (previously asserted wrong values like `"Reksai"`, `"Ksante"`, `"Monkey King"`, `"Kog Maw"`) and one integration test (`loading-screen-builder.integration.test.ts`) that asserted the old-wrong `"Reksai"` for id 421.

**App** (`packages/app/src/lib/criteria-summary.ts`): replaced `` `champion ${id}` `` with `getChampionDisplayNameById(c.championId)` from `@scout-for-lol/data` (app has no dependency on `backend`).

**Report** (`packages/report/src/html`): `champion/names.tsx` and `arena/player-column.tsx` now wrap the display text with `championNameToDisplayName(championName)` at render time — the underlying `championName` field is left untouched since it's also used for `getChampionImage`/`getChampionLoadingImage` asset lookups in the same components.

**Frontend review tool** (`packages/frontend/src/components/review-tool`): `match-details-panel.tsx` (4 sites), `match-reviewer-info.tsx`, `match-list.tsx` all wrap champion name renders with `championNameToDisplayName`. No icon/asset lookups exist in these components, so this was safe to apply directly.

## Out of scope / not touched

- `Champion.championName` Zod field and everything upstream of it (`normalizeChampionName`, `resolveChampionKey`, `match-helpers.ts`, `s3-helpers.ts`, `match-converter.ts`) — these correctly hold the Data Dragon asset key for icon/image lookups; only display call sites changed.
- `getChampionId` / `CHAMPION_NAME_TO_ID` (name→id resolution for autocomplete input parsing) — unrelated to display formatting.
- Database/Prisma storage and the report-lake Parquet columns — internal data, not human-facing.
- Fuse.js fuzzy search over `MatchMetadata.champion` in the frontend review tool still searches the asset key, not the display name — a separate, smaller improvement not requested in this pass.

## Verification

- `data`: `bun run typecheck` clean; `bun test` 442 pass / 0 fail (includes new table-lookup tests).
- `backend`: `bun run typecheck` clean (pre-existing unrelated `llm-observability`/`@opentelemetry` module errors confirmed present on `main` too, out of scope of this change — `--group=scout` scoped installs don't install that package's deps); `bun test` matches the pre-change baseline exactly (7 fail / 5 errors, all pre-existing/unrelated) after fixing the one test that had a stale "Reksai" expectation.
- `app`, `report`, `frontend`: `bun run typecheck` clean. `report`'s two integration snapshot tests (arena, loading-screen/match reports) pass unchanged — verified this is legitimate: the fixture data's rendered/highlighted players happen to all have single-word champion names where asset key == display name, so the fix isn't exercised by those specific snapshots, not a sign the fix is inert (confirmed directly via `bun -e` that `championNameToDisplayName("MonkeyKing") === "Wukong"`).
- `frontend` has no unit test runner wired (`"test": "echo 'Playwright tests disabled'"`); relied on `astro check` + `tsc --noEmit` + `eslint`.
- `bunx eslint` clean (0 errors) across all touched files in every package; remaining warnings are pre-existing code-duplication notices unrelated to this change.

## Session Log — 2026-07-12

### Done

- Implemented and merged (locally, on branch `feature/champion-display-names` in worktree `.claude/worktrees/champion-display-names`) the full champion-display-name unification described above.
- All 8 tracked implementation tasks completed; typecheck/lint/test verified per-package as described in Verification.
- Fixed one incidentally-stale test assertion (`loading-screen-builder.integration.test.ts`) that pinned the old-wrong `"Reksai"` display name for champion 421.

### Remaining

- PR not yet opened — this session did not push or create a PR; that's the next step if the user wants this shipped.
- Out-of-scope item noted above (Fuse.js fuzzy search over asset key instead of display name in the frontend review tool) — not filed as a todo since it's minor and not requested.

### Caveats

- `packages/llm-observability` is not installed under `--group=scout` scoped setup (`bun run scripts/setup.ts --group=scout`), so `bun run typecheck` in `backend`/`app` always shows `@opentelemetry/*` module-not-found errors — confirmed pre-existing via `git stash` comparison, unrelated to this change.
- The `report` package's `bun test` (default glob) does not include the heavier `*.integration.test.ts` files (arena, loading-screen); those were run explicitly and pass.
