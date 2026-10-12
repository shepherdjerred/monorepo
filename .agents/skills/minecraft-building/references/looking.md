# Looking

A render is evidence; the default contact sheet shows a textured exterior and
hides most of what a critic will mark down. Each look below answers one
question. Ask it, do not browse.

| You want to judge                    | Look                                                                              | What to see                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Silhouette, massing                  | `--mode squint` or `--mode value`                                                 | Does the outline read as one box? Where is the second mass, the tower, the roof break?         |
| Depth (relief)                       | `--mode relief`, `--mode normal`, `--views elevations`                            | Flat walls stay one tone; posts, sills, eaves and recesses throw shadows or change colour.     |
| Proportion, rhythm                   | `--views elevations --grid 4`                                                     | Door 2 high, ceilings 3 or more, windows spaced with the posts; count on the grid.             |
| Lighting, interiors                  | `--mode light --floor <y>`, `--section <z>`                                       | Red cells are light level 0. Cut a floor at the ground storey; cut a section through the hall. |
| Eye-level composition, the hero shot | `--views pov`                                                                     | What a player sees walking up: the door, the overhang, the first detail at face height.        |
| What a change did                    | `--compare <earlier render>`                                                      | Before, after, and the plan of changed columns. Confirms the change landed where you meant.    |
| Detail at full resolution            | `--crop front-door` (or `centre`, `nw`, `ne`, `sw`, `se`); maps: `--views survey` | Texture choices, sills, trims. Survey tiles a map at readable scale with an index.             |
| Whole map                            | `--views hero`, `--mode value`                                                    | Focal point, open space, paths that read from above.                                           |

`--floor` and `--section` are build-local (anchor-relative), the same
coordinates as `build.ts`. Every look can read the live canvas (default),
the frozen `expected` result, or `--source compiled` (the captured site plus
the op log applied offline), so `compile → render --source compiled → lint`
needs no server for DSL builds.

## The image budget

Vision reasoning degrades with the number of images in context. Keep at
most 12 renders in the conversation; one judge sheet or compare per
iteration is enough. When you need to refer to an earlier look, cite its
path rather than re-opening it: `[an earlier look: renders/v2-compare.png]`.
After compaction, `toolkit mc build resume <dir>` gives the brief, your
notes, the journal and the state; the renders stay on disk.

## Looking before critiquing

`toolkit mc build critique <dir>` scores the latest render's judge sheet
blind (a letter, no name, no program) 0–5 per rubric axis, then reviews
`build.ts` for ranked changes starting at the lowest axis. Run it after
every render you intend to keep; it records the scores in the journal and
the render's sidecar so `candidate ls` and `resume` show them. Look at the
sheet it saw (`judge/critique-<ts>.png`) before trusting a note.
