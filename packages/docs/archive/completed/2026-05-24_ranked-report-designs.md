# Two new ranked-game report designs for scout-for-lol

## Status

Complete

## Context

The current post-match report ([report.tsx](../../scout-for-lol/packages/report/src/html/report.tsx)) renders every non-arena match with the same cinematic blue-gradient layout — "Outcome" title in gold, time/LP delta, ranked badge(s) in the top-right, then both teams listed as rosters with full champion cards.

We want ranked solo/duo and ranked flex matches to feel **more distinctive and shareable** than normals/clash/ARAM. Two new full-bleed splash-art designs (mockups attached to the originating task) will fire for ranked games:

- **Design A — "Banner"** (wide horizontal, ~3:1): cinematic Riot-style header with a single champion splash, large "Victory/Defeat" title, KDA / LP / Diamond II badge, and a side panel that holds either the solo player's grade _or_ a "THE SQUAD — N" table. Supports 1-5 tracked players.
- **Design B — "Square"** (~1:1): vertical layout with champion splash at top, a "TRACKED SQUAD" card grid (or single hero card if N=1), a Scout commentary blurb, and a final score bar with team-comp icons. Supports 1-5 tracked players.

For each ranked match, **one of the two designs is picked at random** (hash-seeded on a stable match identifier so retries + snapshots are stable).

## Approach

Add two new Satori components alongside `Report`, route ranked queues through a design picker, and seed the random pick by a stable match identifier so snapshot tests stay deterministic.

| Concern                              | Decision                                                                                                                                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **When to fire**                     | `match.queueType === "solo" \|\| "flex"`. Everything else → existing `Report`.                                                                                                                                                                                                                    |
| **Pick mechanic**                    | FNV-1a hash of `players[0].playerConfig.league.leagueAccount.puuid + durationInSeconds` → pick `banner` or `square`. Same match always renders the same design (idempotent retries, stable snapshots). Optional `designOverride` param on `matchToSvg/matchToImage` for tests + manual debugging. |
| **Canvas size**                      | Design-specific. Banner = `4760 × 1500`. Square = `4760 × 4760`. `matchToSvg` becomes design-aware (passes dims into `satori()`).                                                                                                                                                                 |
| **1-5 player handling**              | Internal to each design (component switches between solo-hero and squad-table layouts). Same data shape — no new branches at the routing layer.                                                                                                                                                   |
| **Champion splash**                  | Reuse `preloadChampionLoadingImages` + `getChampionLoadingImage` (already cached). Hero champion = highest-KDA tracked player (or sole player if N=1).                                                                                                                                            |
| **Grade computation**                | KDA-band derived in renderer (`packages/scout-for-lol/packages/report/src/html/shared/grade.ts`). D/C/B/A/S/S+ bands. MVP = highest KDA in the tracked squad.                                                                                                                                     |
| **Scout commentary** (Design B only) | Optional `commentary?: string` on `CompletedMatch`. Renderer hides the box if absent. Backend wires real text in a follow-up.                                                                                                                                                                     |
| **Palette / fonts**                  | Reuse `palette` (gold + dark blue) and `bunBeaufortFonts`/`bunSpiegelFonts`. No new dependencies.                                                                                                                                                                                                 |

## Files

### New components

- `packages/scout-for-lol/packages/report/src/html/shared/grade.ts` — KDA→grade banding + MVP picker
- `packages/scout-for-lol/packages/report/src/html/shared/pick-design.ts` — `pickRankedDesign(match): "banner" | "square"`, FNV-1a-seeded
- `packages/scout-for-lol/packages/report/src/html/shared/splash.tsx` — full-bleed champion splash with vignette gradient
- `packages/scout-for-lol/packages/report/src/html/shared/grade-diamond.tsx` — Reusable D/S/S+ diamond badge
- `packages/scout-for-lol/packages/report/src/html/shared/tier-pill.tsx` — "DIAMOND II" pill (top-right of both designs)
- `packages/scout-for-lol/packages/report/src/html/ranked-banner/report.tsx` — Design A root
- `packages/scout-for-lol/packages/report/src/html/ranked-banner/squad-row.tsx` — Single row in the squad table
- `packages/scout-for-lol/packages/report/src/html/ranked-square/report.tsx` — Design B root
- `packages/scout-for-lol/packages/report/src/html/ranked-square/player-card.tsx` — Tracked-squad card
- `packages/scout-for-lol/packages/report/src/html/ranked-square/score-bar.tsx` — Final 5v5 score bar with team-comp icons

### Modified

- `packages/scout-for-lol/packages/report/src/html/index.tsx` — design routing + `designOverride` opt
- `packages/scout-for-lol/packages/data/src/model/match.ts` — Add `commentary?: string` to `CompletedMatch` (Zod + TS)

### Tests

- `packages/scout-for-lol/packages/report/src/html/ranked-banner/banner.integration.test.ts`
- `packages/scout-for-lol/packages/report/src/html/ranked-square/square.integration.test.ts`
- `packages/scout-for-lol/packages/report/src/html/shared/pick-design.test.ts`

## Out of scope

- Replacing the existing report for non-ranked queues
- Backend wiring for the Scout commentary line
- Arena, prematch loading screens, and competition charts

## Verification

1. `bun run --filter='./packages/scout-for-lol/packages/report' typecheck`
2. `cd packages/scout-for-lol/packages/report && bunx eslint . --fix`
3. `bun run --filter='./packages/scout-for-lol/packages/report' test`
4. Eyeball generated PNGs under `src/html/ranked-banner/__snapshots__/` and `src/html/ranked-square/__snapshots__/` (one per fixture).

## Session Log — 2026-05-24

### Done

- Added optional `commentary?: string` to `CompletedMatch` schema
- Built shared helpers under `packages/scout-for-lol/packages/report/src/html/shared/`: `grade.ts` (KDA→D/C/B/A/S/S+ banding + MVP picker + hero player), `pick-design.ts` (FNV-1a hash-based design picker, `isRankedQueue`), `splash.tsx` (full-bleed champion loading-screen background via `backgroundImage: cover` on a sized div), `grade-diamond.tsx`, `tier-pill.tsx`, `test-fixtures.ts`
- Built `ranked-banner/` (Design A — 4760×1500 wide cinematic banner with solo + squad layouts) and `ranked-square/` (Design B — 4760×4760 with hero band, squad cards or single hero card, optional Scout commentary, bottom score bar with team-comp icons)
- Wired routing in `packages/scout-for-lol/packages/report/src/html/index.tsx` — ranked solo/flex queues hash-pick between banner/square (override via `designOverride` opt); non-ranked queues keep the existing `Report`
- Snapshot tests: 4 banner fixtures (solo victory, solo defeat ranked flex, 3-squad, 5-squad) + 4 square fixtures (solo victory w/ commentary, solo defeat w/o commentary, 5-squad w/ commentary, 3-squad) + pick-design determinism/distribution tests
- Existing `index.test.ts` fixture switched from `queueType: "solo"` → `"draft pick"` so the legacy `Report` continues to be exercised independently of the new ranked path
- Verified: `bun run typecheck` clean, `bunx eslint .` clean, `bun test` 56 pass / 0 fail
- PNG fixtures rendered to disk and visually confirmed (Warwick splash for banner solo, Senna splash for 5-squad since she's MVP, victory in gold, defeat in red, "RANKED FLEX" queue label, MVP badge on highest-KDA tracked player, grade diamonds match KDA bands)

### Remaining

- Backend wiring for the Scout commentary line (`commentary` field is optional on `CompletedMatch` — populate from LLM/template in a follow-up PR)
- Replace existing `Report` for non-ranked queues (out of scope; ship the new designs first and gather feedback)

### Caveats

- Satori discovery: nested `width: "100%"` / `height: "100%"` on `position: absolute` images produces `x="NaN"` and the `objectFit: cover` calculation overflows the canvas (causing `svgToPng` bbox-crop to expand the PNG). `Splash` works around this by using `backgroundImage: url(...)` on an absolutely-positioned div with explicit pixel dimensions and `backgroundSize: "cover"`. Both root containers (`RankedBannerReport`, `RankedSquareReport` hero band) also use explicit pixels for the same reason.
- Mid-session edits accidentally landed in the main checkout (`/Users/jerred/git/monorepo/...`) instead of the worktree. All those edits were migrated into the worktree and the main checkout was restored with `git restore` (no other contributors' uncommitted work touched). The worktree had no `node_modules`; `bun install --frozen-lockfile` was run in the worktree's `scout-for-lol/` and at the repo root to populate them.
- `test-fixtures.ts` uses low-entropy 78-char PUUID literals (`tracked_player_N_fixture_${"X".repeat(53)}`) so the `no-secrets/no-secrets` rule doesn't flag them — the rule exempts only `*.test.ts` files, and this fixture is shared between multiple test files.
