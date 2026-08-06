---
id: reference-completed-2026-05-19-arena-tracked-trios-redesign
type: reference
status: complete
board: false
---

# Arena Report Visual Redesign — "Tracked Trios"

## Context

The user wants the Scout for LoL arena post-match report (`packages/scout-for-lol/packages/report/src/html/arena/`) updated to match the design in `~/Desktop/CleanShot 2026-05-17 at 13.23.29@2x.png` — a layout titled "Tracked Trios" that re-arranges the existing arena report into vertical player columns inside tracked-team cards. Earlier in this session I had been planning against the wrong screenshots ("Heraldic / Spotlight"); the user clarified that those were not the target. The new design keeps champion splash portraits, summoner + champion names, and the "only tracked teams" filter — but flips player rows into columns, swaps the placement badge for a diamond, adds a "Tracked Trios" title and meta header bar, and strips the VICTORY/DEFEAT banner, team K/D/A summary, gold totals, gradient backgrounds, and medal-colored borders.

The mockup itself is in `/tmp/arena-mockups/cleanshot-2x.png` (upscaled for legibility). Output is still satori → SVG → PNG for Discord.

## Visual spec

| Region          | Spec                                                                                                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page background | Deep navy `#0a1525`-ish (unchanged)                                                                                                                                                                                     |
| Top-left header | `ARENA  18min 22s` letter-spaced gold + muted small caps                                                                                                                                                                |
| Top-right meta  | `2 PLAYERS TRACKED · 2 TRIOS` muted gray small caps. Counts derive from `match.players.length` and `match.teams.filter(t => tracked).length` + size word from team size                                                 |
| Title           | `Tracked Trios` / `Tracked Duos` — large gold/tan serif (~36-40px), Beaufort, derived from team size                                                                                                                    |
| Team cards      | Two (or N) side-by-side, equal width. Thin border with subtle inner glow. Padding ~20-24px                                                                                                                              |
| Card header row | `[diamond badge with placement #] [TEAM WOLF letter-spaced gold]` — left-aligned (no LP — arena has no ranked rating)                                                                                                   |
| Diamond badge   | Gold rhombus (rotated square), placement number centered inside, dark text. Replaces today's circular medal                                                                                                             |
| Player column   | 3 (or 2) per card, equal width. Top→bottom: splash art portrait → champion name (muted small caps) → summoner name (white) → KDA (large) → gold damage bar with DMG number → 6-item row → 4 augments stacked vertically |
| Splash portrait | Tall cinematic crop (~2:3 aspect). Re-use the splash URL pipeline that `loading-screen` already uses                                                                                                                    |
| KDA             | `16 / 6 / 9` ~22-24px white bold, no green/red                                                                                                                                                                          |
| Damage bar      | Gold horizontal bar (~3-4px) under KDA, with the number `16,400 DMG` overlaid or beside                                                                                                                                 |
| Items           | Row of 6 small icons (~24px), no scale-transform hacks                                                                                                                                                                  |
| Augments        | 4 stacked vertically. Each row: ~22-24px icon + name (gold muted ~12-13px). No 2×2 grid                                                                                                                                 |

## ASCII layout sketch

Reference: `/tmp/arena-mockups/cleanshot-2x.png`. Sketch below mirrors a 3v3v3 trios match with 2 tracked teams (Wolf placed 2nd, Krug placed 4th).

```
+========================================================================================+
| ARENA  18min 22s                                       2 PLAYERS TRACKED · 2 TRIOS    |  <- page header row (left/right, muted small caps)
|                                                                                        |
| Tracked Trios                                                                          |  <- big gold/tan serif title (~40px Beaufort)
|                                                                                        |
| +------------------------------------------+ +------------------------------------------+
| | <◆2>  T E A M   W O L F                  | | <◆4>  T E A M   K R U G                  |  <- diamond placement badge + letter-spaced gold label
| |                                          | |                                          |
| | +------------+ +------------+ +--------+ | | +------------+ +------------+ +--------+ |
| | |            | |            | |        | | | |            | |            | |        | |
| | |  champion  | |  champion  | | champ. | | | |  champion  | |  champion  | | champ. | |  <- tall splash crop (~2:3 aspect)
| | |   splash   | |   splash   | | splash | | | |   splash   | |   splash   | | splash | |
| | |            | |            | |        | | | |            | |            | |        | |
| | +------------+ +------------+ +--------+ | | +------------+ +------------+ +--------+ |
| |  EMICH         CARYL          SENNA      | |  DARIUS        CAITLYN       QUINN       |  <- champion name (muted small caps)
| |  ce_ultra...   goblin_abu...  defend_d.. | |  DarkMermaid.. Rosaak        BugOverflow |  <- summoner name (white, truncates)
| |                                          | |                                          |
| |  16 / 6 / 9    14 / 7 / 11    6 / 8 / 24 | |  11 / 11 / 5   9 / 13 / 8   12 / 12 / 4  |  <- KDA (large white, no win-state color)
| |  ============  ==============  ========= | |  ==========    ==========    ==========  |  <- gold damage bar (full column width)
| |  13,200 DMG    19,500 DMG     12,800 DMG | |  14,100 DMG    16,400 DMG    11,200 DMG  |  <- damage number + DMG suffix
| |                                          | |                                          |
| |  [][][][][][]  [][][][][][]  [][][][][][]| |  [][][][][][]  [][][][][][]  [][][][][][]|  <- row of 6 item icons
| |                                          | |                                          |
| |  ★ Executioner ★ Apex Inv.   ★ Quickdraw | |  ★ Buff Bud.   ★ Bladework   ★ Spirit L.|
| |  ★ Blade Waltz ★ Combo Mstr  ★ Phenom    | |  ★ Untouch.    ★ Banner       ★ Big Brain|  <- 4 augments stacked vertically per player
| |  ★ Apex Invent ★ Repulsor    ★ Adapt Hlm | |  ★ Banner      ★ Spirit Link  ★ Indust.  |     (icon + name, no 2x2 pairing)
| |  ★ Combo Mstr  ★ Lightspeed  ★ Marksmagic| |  ★ Dawn Rslv.  ★ Marksmagic   ★ Restless |
| +------------------------------------------+ +------------------------------------------+
+========================================================================================+

Legend:  <◆N> = gold diamond badge with placement N    ===== = gold horizontal damage bar
         [] = 24px item icon                            ★ = ~22px augment icon (purple thin border)
```

For 2v2v2v2 (duos) the title flips to `Tracked Duos`, the meta bar says `N PLAYERS TRACKED · N DUOS`, and each card has only 2 player columns instead of 3. For a single tracked team the card is rendered alone (left-aligned, same width as in the 2-card layout).

## Files to modify

All paths under `packages/scout-for-lol/packages/report/src/html/arena/`.

| File                                                                | Change                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.tsx`                                                         | Drop canvas dims — likely `1600 × ~1100` for a 2-team trios card (much shorter than current 6000). Compute height based on team count if needed. Preload splash-art URLs alongside champion images (look at how `loading-screen` does it) |
| `report.tsx`                                                        | Replace vertical stack with horizontal flex (cards side-by-side, equal width). **Keep** the `highlightNames` filter (only render teams with tracked players). Add new `<PageHeader>` and `<TitleBar>` above the cards                     |
| `match-header.tsx` → split into `page-header.tsx` + `title-bar.tsx` | `page-header.tsx`: left = `ARENA <duration>`, right = `<N> PLAYERS TRACKED · <N> <size-word-uppercase>`. `title-bar.tsx`: big serif `Tracked <SizeWord>` title (Trios/Duos)                                                               |
| `team-card.tsx`                                                     | New chrome: thin border, subtle dark fill (no gradient). Header row = `<DiamondBadge>` + `<TeamLabel>`. Body = horizontal flex of `<PlayerColumn>` (one per player). Equal-width columns                                                  |
| `team-header.tsx`                                                   | Rewrite: small horizontal row, no K/D/A, no gold total, no vertical stacking. Just diamond badge + letter-spaced team label                                                                                                               |
| `player-card.tsx` → **rename** to `player-column.tsx`               | Flip to vertical: splash → champ name → summoner name → KDA → damage bar+number → items row → augments column                                                                                                                             |
| `champion-info.tsx`                                                 | Repurpose/inline into `player-column.tsx`. Replace the small square `getChampionImage` with a taller splash crop (use the same image source `loading-screen` uses)                                                                        |
| `damage.tsx`                                                        | Re-tune for the column layout: full-column-width gold bar ~3-4px tall, number on top of/beside the bar                                                                                                                                    |
| `augments-display.tsx`                                              | Replace 2×2 pair grid with single `flex-col gap 4-6`                                                                                                                                                                                      |
| `augment.tsx`                                                       | Smaller icon (~22-24px), tighter row, name uses gold-muted color                                                                                                                                                                          |
| `placement-badge.tsx`                                               | Rewrite as a **gold diamond** (rotated square) with placement number centered. Drop the medal-color logic (gold/silver/bronze) — single gold style                                                                                        |
| `team-stats.tsx`                                                    | **Delete** (K/D/A team summary not in new design)                                                                                                                                                                                         |
| `utils.ts`                                                          | Delete `getTeamStyling`, `getMedalBorder`, `getMedalBoxShadow`. Keep `formatDuration` + `filterDisplayAugments`. Add `getTeamSizeWord(team)` → `"Trio"` / `"Duo"`                                                                         |

## New chrome components

- `<DiamondBadge placement={n} />` — rotated gold square, number centered (replaces circular `PlacementBadge`)
- `<TitleBar match={match} />` — renders "Tracked Trios" / "Tracked Duos"
- `<PageHeader match={match} trackedCount={n} sizeWord={"Trio"|"Duo"} />` — left/right header row

## Implementation order

1. **Page chrome**: `page-header.tsx` + `title-bar.tsx` + outer flex in `report.tsx`
2. **Card chrome**: `team-card.tsx` header row + `placement-badge.tsx` rewritten as diamond
3. **Player column**: `player-column.tsx` with splash portrait + identity text + KDA
4. **Inner blocks**: `damage.tsx`, `augments-display.tsx`, `augment.tsx`
5. **Cleanup**: delete `champion-info.tsx`, `team-stats.tsx`, dead `utils.ts` helpers
6. **Regenerate snapshots** (`bun test -u` in `packages/report`) and visually inspect output PNGs

## Verification

1. `cd packages/scout-for-lol/packages/report && bun run typecheck`
2. `cd packages/scout-for-lol/packages/report && bun test -u` (regenerate snapshots)
3. Render PNGs for `testdata/1.json` and `testdata/2.json` (2v2v2v2) and `testdata/3v3.json` (3v3v3). Drop both PNGs in the worktree and visually compare against `/tmp/arena-mockups/cleanshot-2x.png`
4. `bunx eslint packages/scout-for-lol/packages/report --fix` (custom rules: `satori-best-practices`, `no-type-assertions`)
5. Confirm: title says "Tracked Trios" on 3v3v3 testdata, "Tracked Duos" on 2v2v2v2 testdata; meta bar shows correct counts; diamond badges show placement; splash portraits load (no fallback boxes)
