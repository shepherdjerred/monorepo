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

| Call                                                                                         | Notes                                                         |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `ctx.set(x, y, z, mat)` / `ctx.fill(regionOrBox, mat)` / `ctx.clear(box)`                    | `mat` = state string or `(x,y,z) => state`                    |
| `ctx.geo.box / hollowBox / outline / cylinder / union / subtract / intersect / face / edges` | Regions                                                       |
| `ctx.site?.heightAt(x, z)`                                                                   | First free y above terrain (local), with a captured site      |
| `ctx.rng()`                                                                                  | Deterministic random in [0,1)                                 |
| `ctx.noise(x, z, { scale?, octaves?, ridged?, salt? })`                                      | Deterministic 2D fractal noise in [0,1) for terrain and masks |

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

| Call                                                                                                     | Notes                                                                          |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `foundation({ x, z, w, d, y, height?, material })`                                                       | Extends down to terrain with a site → `{ top }`                                |
| `floor({ x, z, w, d, y, material })`                                                                     |                                                                                |
| `walls({ x, z, w, d, y, h, frame, infill, postEvery?, postsAt?, depth? })`                               | Timber frame, infill recessed 1 (depth 0 = flush) → `{ faces, top, interior }` |
| `window(face, { at, y?, w?, h?, glass?, sill?, shutters? })`                                             | Glass in the recess, sill stairs outside                                       |
| `door(face, { at, door })`                                                                               | Two halves on the floor; frame the door with `postsAt`                         |
| `gableRoof({ x, z, w, d, y, ridge, stairs, overhang?, gable?, eaves?, ridgeBlock? })`                    | Stair slopes, gable ends, ridge cap                                            |
| `hipRoof({ x, z, w, d, y, stairs, overhang?, eaves?, ridgeBlock? })`                                     | Slopes on all four sides, outer-corner stairs, ridge cap on odd spans          |
| `chimney({ x, z, base, height, material, size?, cap? })`                                                 | Masonry stack (1 or 2 square); place after the roof; `cap: "campfire"` smokes  |
| `trim(face, { v, material, layer? })`                                                                    | Horizontal band (string course)                                                |
| `conicalRoof({ x, z, y, radius, stairs, overhang?, peak? })`                                             | Round cone of stair rings for a round tower → `{ top }`                        |
| `mansardRoof({ x, z, w, d, y, wall, stairs, steps?, cap? })`                                             | Steep stepped wall-and-stair tiers, flat cap → `{ top }`                       |
| `dormer({ x, z, w, d, y, facing, wall, stairs, h?, glass? })`                                            | Carves the roof, glazed face, small gable; after the main roof                 |
| `tower({ x, z, y, shape, radius, h, wall, floor?, floorEvery?, crenellations?, door?, slits?, light? })` | Round or square, lit floors, slits, battlements → `{ top, center }`            |
| `porch({ face, at, w, depth?, floor, post, roof, railing?, height? })`                                   | Deck, posts, slab roof on a wall face → `{ entrance }`                         |
| `interior({ room, wood?, bed?, items?, light? })`                                                        | Bed, bookshelves, table and chairs, lights in a walls `interior`               |
| `landscape({ area, y, ground?, density?, flowers?, bushes?, avoid?, seed? })`                            | Grass, flowers and bushes around the build; `avoid` boxes                      |
| `path({ from, to, y, width?, material? })`                                                               | L-shaped gravel/dirt-path walk → `{ cells }`                                   |

Faces are addressed from outside: `u` left→right, `v` up from the wall base,
`layer` 0 outer plane, 1 one block in, −1 one block out.

Stair `shape` (corners) is computed on compile from neighbouring stairs, as
the game does on placement, so roof corners and L-shaped eaves come out right.

## Composing

- **Second story:** `floor` at the first walls' `top - 1`, then another
  `walls` with `y: first.top` (often shorter, `h: 3`), and the roof on the
  upper `top`. A `trim` band at the first story's top reads as a jetty.
- **L-shape:** two adjacent footprints (e.g. main `{0,0,9,7}`, wing
  `{0,7,5,5}`), each with its own `walls`; `ctx.clear` the shared wall to join
  the rooms. Roof the main block first (hip), then the wing (gable with
  `ridge` running away from the main block) so its roof cuts into the slope.
  Check the junction in the render; it is the usual weak spot.
- **Exterior chimney:** `x` just outside a wall, `base` at the foundation,
  tall enough to clear the roof by 2–3 blocks.

## Library

`toolkit mc build library ls|search --tag <t>|show <slug>` lists curated,
lint-clean programs (cottage, nordic two-story, desert L-house, watchtower,
chapel, bridge, plaza well, market stalls). `library use <slug> <dir>` copies
one as the build's `build.ts`; start from the closest one and adapt it rather
than from the blank scaffold.
