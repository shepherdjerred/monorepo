# mc-build DSL cheat sheet

`build.ts` exports a pure function; compile runs it in a child process and
turns the result into a schematic paste at `anchor + min`.

```ts
import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";
export default ((ctx) => {
  /* … */
}) satisfies BuildProgram;
```

## Frame

- `+x` right, `+y` up, `+z` toward the **front**. At rotate 0 the front faces
  south: front=south, back=north, right=east, left=west.
- `(0,0,0)` is `anchor` from `build.json`. Negative coordinates are fine
  (overhangs).
- Boxes are `{ x, y, z, w, h, d }` (origin + size), never two corners.
- Cells start as KEEP (world untouched). `ctx.clear(box)` writes explicit air.

## Core

| Call                                                                                         | Notes                                                    |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `ctx.set(x, y, z, mat)` / `ctx.fill(regionOrBox, mat)` / `ctx.clear(box)`                    | `mat` = state string or `(x,y,z) => state`               |
| `ctx.geo.box / hollowBox / outline / cylinder / union / subtract / intersect / face / edges` | Regions                                                  |
| `ctx.site?.heightAt(x, z)`                                                                   | First free y above terrain (local), with a captured site |
| `ctx.rng()`                                                                                  | Deterministic random in [0,1)                            |

## Materials (`ctx.mat`)

| Call                                                                                            | Returns                                                                               |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `block("oak_stairs", { facing: "east" })`                                                       | Validated full state (unknown names throw with suggestions)                           |
| `stairs(id, { ascend: "back", half: "top" })`                                                   | Stairs climbing toward a build direction                                              |
| `axis(logState, "x" \| "y" \| "z")`                                                             | Logs/pillars oriented                                                                 |
| `family("spruce")`                                                                              | planks, log, strippedLog, stairs, slab, fence, door, trapdoor, …                      |
| `family("stone_bricks")`                                                                        | block, stairs, slab, wall                                                             |
| `palette([["stone", 3], ["andesite", 1]])`                                                      | Seeded per-cell mix                                                                   |
| `noise([...], { scale: 3 })`                                                                    | Patchy, coherent mix (better than salt-and-pepper)                                    |
| `gradient(["mossy_cobblestone", "cobblestone", "stone_bricks"], { axis: "y", from: 0, to: 6 })` | Weathering bands                                                                      |
| `theme("medieval" \| "nordic" \| "desert")`                                                     | foundation, frame, infill, roof, roofSlab, trim, floor, glass, door, shutter, lantern |

## Craft (`ctx.craft`) — each returns anchors

| Call                                                                                  | Notes                                                                          |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `foundation({ x, z, w, d, y, height?, material })`                                    | Extends down to terrain with a site → `{ top }`                                |
| `floor({ x, z, w, d, y, material })`                                                  |                                                                                |
| `walls({ x, z, w, d, y, h, frame, infill, postEvery?, postsAt?, depth? })`            | Timber frame, infill recessed 1 (depth 0 = flush) → `{ faces, top, interior }` |
| `window(face, { at, y?, w?, h?, glass?, sill?, shutters? })`                          | Glass in the recess, sill stairs outside                                       |
| `door(face, { at, door })`                                                            | Two halves on the floor; frame the door with `postsAt`                         |
| `gableRoof({ x, z, w, d, y, ridge, stairs, overhang?, gable?, eaves?, ridgeBlock? })` | Stair slopes, gable ends, ridge cap                                            |
| `trim(face, { v, material, layer? })`                                                 | Horizontal band (string course)                                                |

Faces are addressed from outside: `u` left→right, `v` up from the wall base,
`layer` 0 outer plane, 1 one block in, −1 one block out.
