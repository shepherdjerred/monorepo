---
id: reference-completed-2026-05-30-compact-scout-action-showcase
type: reference
status: complete
board: false
---

# Compact Scout Action Showcase

## Summary

Compact the Scout marketing page's "See Scout in Action" section so it highlights three clear buyer cases instead of rendering the full generated screenshot gallery.

## Plan

- Replace the full generated showcase gallery on `packages/scout-for-lol/packages/frontend/src/pages/index.astro` with three curated cases: different game modes, one tracked player, and multiple tracked players.
- Select showcase images by stable generated asset IDs and omit missing optional assets without failing the page.
- Remove or shorten redundant feature bands below the showcase so the section stays materially shorter.
- Keep existing generated asset data and public interfaces unchanged.

## Verification

- `bun run typecheck` in `packages/scout-for-lol/packages/frontend`
- `PUBLIC_PINTEREST_TAG_ID=placeholder PUBLIC_REDDIT_PIXEL_ID=placeholder bun run build` in `packages/scout-for-lol/packages/frontend`
- `bun run lint` in `packages/scout-for-lol/packages/frontend`
- Desktop and mobile visual check of the built home page via local Astro preview.
