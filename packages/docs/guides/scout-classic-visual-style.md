---
id: scout-classic-visual-style
type: guide
status: complete
board: false
---

# Scout League Classic Visual Style

This guide applies only to Scout's `classic` prematch and postmatch reports.
It must not change the visual tokens for ranked, ARAM, Arena, the marketing
site, or the authenticated app.

## Provenance Labels

- **Verified**: supported by a named external source or an inspected font file.
- **Measured**: taken from a specific reference screenshot.
- **Selected**: a Scout implementation choice made to reproduce the reference
  at a different canvas size.
- **Unknown**: not recoverable with confidence from available sources.

The typed source of truth is
`packages/scout-for-lol/packages/report/src/assets/classic-style.ts`. This guide
explains why those values exist; it does not duplicate runtime behavior.

## References

- **Verified:** [Fonts In Use documents](https://fontsinuse.com/uses/26935/league-of-legends-game-and-website)
  Friz Quadrata and Gill Sans in the pre-2015 game client, followed later by
  Beaufort and Spiegel.
- **Verified:** [CTAN Qualitype metadata](https://ctan.org/pkg/qualitype) lists
  the Qualitype collection under GPL 2-or-later and SIL OFL licenses. Scout
  uses QTFrizQuad as a metric-compatible replacement for commercial ITC Friz
  Quadrata and ships the upstream `COPYING-QUALITYPE`.
- **Measured:** primary prematch reference:
  `/Users/jerred/Downloads/league classic/6004f63c8209eef5b2aec98c_Loading-Screen-1.jpg`,
  2880×1920.
- **Measured:** primary postmatch reference:
  `/Users/jerred/Downloads/league classic/nostalgic-screenshot-from-the-client-in-2015-v0-c696o6hms9261.png.webp`,
  1275×795.
- **Measured:** supporting screenshots in
  `/Users/jerred/Downloads/league classic/`, spanning 2013-era parchment
  surfaces and 2015 blue-steel client chrome.

The screenshots establish composition, hierarchy, density, and relative
color relationships. They are not color-managed design source files, so exact
original client color tokens remain **unknown**.

## Typography

| Role                                    | Family     |  Weight | Provenance                                                     |
| --------------------------------------- | ---------- | ------: | -------------------------------------------------------------- |
| Results, champion names, section titles | QTFrizQuad | 400/700 | **Selected**, based on **verified** historic Friz Quadrata use |
| Riot IDs, statistics, labels            | Gill Sans  | 400/700 | **Verified** historic family; local files inspected from macOS |

The scale is **selected** for legibility in Discord's image viewer:

| Token       | Size / line height |
| ----------- | ------------------ |
| XL          | 64 / 64            |
| Large       | 44 / 48            |
| Medium      | 28 / 32            |
| Body Large  | 22 / 28            |
| Body Medium | 20 / 24            |
| Caption     | 16 / 20            |

### Licensing Boundary

Both families are committed under
`packages/scout-for-lol/packages/report/src/assets/fonts/`:

- **QTFrizQuad** Regular and Bold — Qualitype license (`QTFrizQuad/COPYING-QUALITYPE`).
- **Gill Sans** Regular and Bold — redistributed under the repository owner's
  **universal redistribution license** (`GillSans/LICENSE.md`). The TTC is split
  into Regular and Bold TTFs because Satori does not accept TrueType Collection
  containers.

Both are loaded directly from disk by `bunClassicFonts()`
(`report/src/assets/classic-fonts.ts`), exactly like the marketing site's
Beaufort/Spiegel fonts — no runtime download, no checksum manifest, and no
environment variables. Rendering works identically in local dev, CI, and prod.

## Color

All hex values below are **selected** from the measured relationships in the
reference screenshots. They are not claimed as recovered Riot source tokens.

| Role              | Token                           | Value                             |
| ----------------- | ------------------------------- | --------------------------------- |
| Canvas            | canvas                          | `#050D17`                         |
| Panel             | panel                           | `#06111B`                         |
| Raised panel      | raised                          | `#0F1322`                         |
| Blue team         | steel deep / accent / highlight | `#1B344D` / `#2D6892` / `#6E90AF` |
| Red team          | red deep / accent / highlight   | `#210C0C` / `#992E1E` / `#C89B93` |
| Gold              | shadow / base / highlight       | `#5A472A` / `#BF9869` / `#E1C978` |
| Text              | strong / primary / secondary    | `#F2ECDB` / `#E7E2D3` / `#A4A9AD` |
| Parchment         | base / raised / highlight       | `#E5D5A0` / `#EBDEAA` / `#F2ECDB` |
| Parchment details | border / ink                    | `#C8B275` / `#273D47`             |

Use team color for structure, not every label. Gold is reserved for result
titles, tracked-player markers, and narrow ornamental rules. Avoid gradients
that turn the reports into modern glossy cards; the reference reads as layered
steel frames over subdued illustrated backgrounds.

## Geometry

### Prematch

- **Selected:** 1920×1280 canvas.
- **Selected:** 128px side margins; five 320px cards with 16px gaps at full
  roster size.
- **Selected:** top and bottom team rows are 560px tall, separated by 128px.
- **Selected:** 420px champion art, 38px champion name, 34px Riot ID, and 68px
  utility strip.
- **Measured relationship:** blue is the top team and red the bottom team,
  separated by a central versus treatment.
- **Selected:** 4px outer frame, 2px inner frame, maximum 6px corner radius.
- Partial teams are centered. Missing players never produce empty fake cards.

### Postmatch

- **Selected:** 1920px width and dynamic height
  `520 + 68 × participant count`.
- **Selected:** 300px hero header, then one block per team: 44px summary, 36px
  column header, and 68px per player.
- **Selected:** table inner width 1872px with 6px row padding and 16px column
  gaps; team summaries use 20px horizontal padding.
- **Selected:** column widths are
  `64, 72, 462, 190, 120, 470, 190, 180`.
- **Measured relationship:** portrait and level lead each row; Riot ID and
  champion identity precede KDA, spells, items, gold, and CS.
- **Selected:** seven 56px item slots with 6px gaps. Empty slots retain their
  frame so row geometry does not move.

## Content Rules

Classic prematch contains champion art/name, Riot ID exactly as supplied by
Spectator-V5, two Classic spell icons, team framing, and tracked-player
markers. It excludes rank, lane labels, bans, runes, profile icons, and load
percentage.

Classic postmatch contains result, map, duration, team totals, level, Classic
portrait, full Riot ID, KDA, two Classic spells, seven items, gold, and CS. It
excludes rank/LP, damage, vision, runes, AI review, rewards, chat, and social
controls.

## Session Log — 2026-07-29

### Done

- Documented the Classic-only type, color, geometry, content, and licensing
  system with verified/measured/selected/unknown provenance.
- Recorded the exact private Gill Sans checksums and public QTFrizQuad license
  boundary.
- Rendered and visually reviewed full and partial prematch reports plus full
  and partial postmatch reports using the checksum-pinned fonts.
- Attached the accepted full prematch, partial prematch, and full postmatch
  renders to PR #1849.
- Marked this completed guide with the canonical `complete` workflow status
  after focused docs validation rejected the non-taxonomy `active` value.

### Remaining

- None.

### Caveats

- Exact original Riot client colors and spacing are unknown; screenshot-derived
  relationships informed selected Scout tokens.
- Gill Sans redistribution is not authorized. Only checksum-verified private
  runtime loading is permitted.

## Session Log — 2026-07-30

### Done

- Superseded the private-font apparatus: the owner holds a **universal
  redistribution license** for Gill Sans, so both Gill Sans and QTFrizQuad are
  now committed under `report/src/assets/fonts/` and loaded directly by
  `bunClassicFonts()`.
- Removed the SeaweedFS download + SHA-256 checksum path, the
  `classic-fonts.json` manifest, the `SCOUT_CLASSIC_GILL_SANS_*` env fallback,
  the backend `ensureClassicFontsConfigured` startup step, the standalone
  `scout-classic-visuals` Buildkite lane, and the `scout-classic-fonts` tofu
  bucket resource. Updated the Licensing Boundary section above.

### Remaining

- Operator: decommission the now-unmanaged `scout-classic-fonts` SeaweedFS
  bucket and its objects.

### Caveats

- **Supersedes the 2026-07-29 caveat above:** Gill Sans redistribution **is**
  authorized under the owner's universal license; the private-only loading
  requirement no longer applies.
