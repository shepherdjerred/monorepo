# Build critique rubric

Score each 0–2 from the contact sheet, fix the lowest first.

| Aspect     | 2 looks like                                                                     | Common fix                                               |
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

Write each iteration's critique in this shape, from the rendered sheet (not
from memory of the code):

```text
iteration 2: silhouette 1, depth 2, palette 2, texture 1, proportion 2,
detail 0, site fit 1, lighting 2 — total 11/16
lowest: detail (0) — bare walls at the entrance
change: chimney on the right wall, flower boxes under the front windows
```

- Change the lowest aspect first; one focused change per iteration beats
  many small tweaks.
- Two iterations minimum. Stop at 14/16 or after five iterations.
- Untouched theme defaults (one box, one gable, no details) cap silhouette and
  detail at 1. Vary the massing, the roof type, and add a detail.
- The final report lists the scores and at least one weakness that remains.
