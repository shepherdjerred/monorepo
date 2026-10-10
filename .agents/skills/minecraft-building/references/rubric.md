# Build critique rubric

`toolkit mc build critique <dir>` scores these axes 0–5 from the judge sheet
(0 absent, 3 competent, 5 would pass for a professional build team's work)
and ranks changes to `build.ts` from the lowest axis. When you score by eye
instead, use the same scale and the same order, and fix the lowest first.

| Aspect     | 5 looks like                                                                     | Common fix                                               |
| ---------- | -------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Silhouette | Varied roofline, not a box; reads from every iso angle                           | Dormers, cross gables, a tower, stepped massing          |
| Depth      | Walls have ≥1 block relief: proud posts/beams, recessed panels, sills, overhangs | `walls` depth 1, sills, eaves, trim bands, jetties       |
| Palette    | 3–5 related blocks; frame contrasts infill; roof distinct                        | `theme`, `noise`/`gradient` for weathering               |
| Texture    | Large surfaces are mixed, not flat single blocks                                 | `mat.noise`, WorldEdit `%` mixes, mossy/cracked variants |
| Proportion | Doors 2 high, ceilings ≥3, windows in rhythm with posts                          | Check the front elevation against the player silhouette  |
| Detail     | Lanterns, flower boxes, fences, chimneys at a sensible density                   | Add 2–3 details near entrances and corners               |
| Site fit   | Sits on the terrain (no floating corners), path to the door, landscaping         | `foundation` with a site, `//overlay`, paths, hedges     |
| Lighting   | No dark interiors (lint `W_DARK_INTERIOR` clean)                                 | Lanterns every ~7 blocks inside                          |

Lint errors (floating, unsupported, decaying leaves) are bugs, not style:
fix them before critiquing looks.

## Critique protocol

Each iteration: render, then `toolkit mc build critique <dir>`. It prints
the critique in this shape and records it (journal, `judge/`, the render's
sidecar):

```text
iteration 2 (v2): lighting 3, siteFit 2, proportion 3, palette 3, texture 2,
depth 1, detail 2, silhouette 2 — total 18/40, aesthetic 2/5
lowest: depth (1)
  - flat east wall, one tone in NORMAL
  - no eaves (HERO)
changes, best first:
  1. [depth] inset the nave windows by one block and add sills — walls()
  2. [detail] chimney on the north gable — roof()
```

Without a model credential, score by eye in the same shape, from the sheet
(not from memory of the code), and record it with `toolkit mc build critique
<dir> --scores "lighting=3,…,silhouette=2,aesthetic=2" --note "flat east
wall"`: it is journalled as a critique (model `by-eye`) and counts toward
the two critiqued iterations.

- Change the lowest axis first; one focused change per iteration beats
  many small tweaks. Save the version before and after
  (`candidate save --name <n>`) and let `candidate knockout` choose.
- Two critiqued iterations minimum. Stop at 4/5 on every axis or after
  five iterations.
- Untouched theme defaults (one box, one gable, no details) cap silhouette
  and detail at 2. Vary the massing, the roof type, and add a detail.
- The final report lists the scores and at least one weakness that remains.

## Procedural tells

Fix these before scoring; each caps the aspect in brackets at 2.

- One box with one ridge, square footprint [silhouette]; flat walls with
  flush openings or no eaves [depth]; full `glass` blocks in walls [depth].
- One block per surface, confetti noise, stripes, rainbow palettes or
  isolated colour blobs [palette/texture].
- Detail on every surface, or only on the front [detail].
- Dirt showing under walls, a flattened site, perfect slopes, straight
  7+ block edges, spherical boulders [site fit].
- Lollipop or identical pasted trees, flowers in many colours scattered
  evenly [site fit/detail].
- Grid streets of identical houses, single-block straight roads, torch
  spam [maps: variety, edges, life].

See craft.md, palettes.md and landscape.md for the fixes.
