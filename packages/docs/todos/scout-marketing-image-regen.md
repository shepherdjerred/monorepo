---
id: scout-marketing-image-regen
status: active
origin: packages/docs/logs/2026-06-13_new-todos-batch.md
source_marker: false
---

# Generate new Scout for LoL ads + homepage images from the showcase generator

## What

Use the recently-written showcase image generator to produce fresh ad and
homepage imagery, replacing the stale/oversized marketing JPEGs.

- **Generator** `packages/scout-for-lol/packages/backend/src/showcase/generate.ts`,
  CLI `packages/scout-for-lol/packages/backend/scripts/generate-marketing-showcase.ts`.
  Reads a manifest, renders match reports / Discord screenshots / competition
  charts, writes PNGs to
  `packages/scout-for-lol/packages/frontend/public/generated/scout-showcase/`
  and an index at
  `packages/scout-for-lol/packages/frontend/src/data/generated/scout-showcase-assets.json`.
- **Current marketing assets** in `packages/scout-for-lol/assets/` are stale and
  oversized: `banner.jpeg` (~8 MB), `beta.jpeg` (~10 MB), `scout.jpeg` (~9 MB) —
  also flagged in [large-file-cleanup.md](large-file-cleanup.md).

## Why it's open

The generator exists and produces report-style showcase images, but the
homepage hero / ad imagery still uses old hand-made JPEGs. Regenerating from the
generator keeps marketing visuals consistent with the real product output and
lets us drop the heavy JPEGs.

## Done when

- New ad + homepage images generated from the showcase generator and wired into
  the marketing site.
- The oversized `assets/*.jpeg` files are replaced (re-encoded to WebP/AVIF or
  swapped for generated PNGs) — coordinate with `large-file-cleanup`.
