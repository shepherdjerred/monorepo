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
