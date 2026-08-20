# Scout for League of Legends Report

Generates League of Legends match report images from match data. React
components are rendered to SVG with Satori and Yoga, then converted to PNG
with resvg. The package can also be consumed as a set of React components
(`./browser` export).

## Renderers

- **Classic**: the 4760×3500 report for non-ranked queues, including League
  Classic (`JADE`) matches. Classic match data is normalized through the
  dedicated Classic champion-ID and asset catalog before rendering.
- **Ranked banner** (`src/html/ranked-banner/`, 4760×1500) and **ranked
  square** (`src/html/ranked-square/`, 4760×4760): two deterministic designs
  for ranked solo/duo and flex matches with a tracked player.
  `pickRankedDesign` hashes stable match data so retries render the same
  design; `MatchRenderOptions.designOverride` forces one for tests and
  debugging, and `enableRankedDesigns` gates the pair entirely.
- Arena, loading-screen, analytics/competition chart (ECharts), and Discord
  screenshot renderers live alongside them under `src/html/`.

## Snapshots

Rendering is deterministic, so the test suites commit SVG and hash snapshot
artifacts (`src/html/**/__snapshots__/`). The ranked banner/square suites are
also rerun by `bun run update-data-dragon` in `@scout-for-lol/data`, which
rewrites their committed artifacts when champion assets change.

## Commands

```bash
bun run test                    # Snapshot + unit tests
bun run typecheck               # tsc --noEmit
bun run lint                    # ESLint
bun run verify:classic-visuals  # Classic renderer visual check
```

See the Scout [AGENTS.md](../../AGENTS.md) for renderer routing details and
satori constraints (enforced by the `satori-best-practices` ESLint rule).
