---
id: reference-completed-2026-05-22-scout-report-image-tweaks
type: reference
status: complete
board: false
---

# Scout Report Image Tweaks

## Summary

Update `@scout-for-lol/report` image rendering for tighter Arena prematch sizing, corrected Arena postmatch damage share text and spacing, and champion portrait icons in standard postmatch rows.

## Key Changes

- Arena prematch uses a canvas sized around the tracked players actually rendered, while standard loading screens keep the existing `1600 x 1350` canvas.
- Arena postmatch keeps damage bars scaled to the highest-damage teammate, but labels `% of Duo` / `% of Trio` from each player's share of total team damage.
- Arena postmatch gets a slightly taller fixed canvas and more spacing between placement and team name so six augment rows fit cleanly.
- Standard Draft/Ranked/Normal postmatch rows show circular Data Dragon champion square portraits beside each player/champion name.

## Test Plan

- `cd packages/scout-for-lol/packages/report && bun test src/html/loading-screen src/html/arena src/html/index.test.ts`
- `cd packages/scout-for-lol/packages/report && bun run typecheck && bun run lint`
- Render-check Arena prematch, Arena postmatch, and standard postmatch PNGs.
