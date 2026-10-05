# Maps: towns, islands and landscapes

Use this when the job is bigger than one building. Follow the normal loop in
the skill (capture, canvas, author, run, render, lint, promote); this adds
what changes at 60–128 blocks.

## Plan the layout first

Write a short plan with coordinates before any blocks:

- site box and sea or ground level; total relief (a hill or peak should rise
  15–30 blocks across the site, or it will not read in renders);
- one focal point (keep, lighthouse, temple) on the highest or most exposed
  spot, and the sight line to it;
- districts and landmarks: 2–3 large buildings (hall, chapel, tavern,
  warehouse) among smaller houses, so sizes vary;
- streets and paths, walls and gates, docks;
- open space: plazas, fields, gardens, cliffs and water. Keep 30–40% of the
  ground unbuilt; wall-to-wall roofs read as one blob.

## One program, one heightfield (default)

Author terrain and structures in the same `build.ts` and keep the ground in an
array, so buildings sit on the terrain you generated:

```ts
const N = 96;
const height: number[][] = []; // local y of the ground surface per (x, z)
for (let x = 0; x < N; x++) {
  height[x] = [];
  for (let z = 0; z < N; z++) {
    const d = Math.hypot((x - 48) / 34, (z - 46) / 36); // island mask
    const ripple =
      1.6 * Math.sin(x * 0.21 + z * 0.13) + Math.cos(z * 0.37 - x * 0.09);
    height[x]![z] = Math.floor(d < 1 ? (1 - d) * 18 + ripple : -4);
  }
}
const occupied = new Set<string>(); // "x,z" cells taken by buildings/streets
```

- Fill each column from bedrock to `height`, with surface, subsoil and rock
  layers; water up to sea level where `height` is lower.
- Seat structures on `height`: `craft.foundation` only finds captured
  ground, so pass `y` = the lowest `height` under the footprint and `height`
  = floor level − that `y`. Terrace steep plots with retaining walls rather
  than floating floors.
- Mark streets and footprints in `occupied`, then scatter trees, flowers and
  boulders with `ctx.rng()` only on free cells.
- Shape terrain on purpose: add cliffs, buttresses, scree and a second peak
  to break a smooth cone; carve a valley or harbor; vary beach width.
- `Math.sin`, `Math.hypot` and friends are fine; `Math.random` is not (use
  `ctx.rng()`).

`ctx.site.heightAt` reads the **captured** site, not terrain your program or
earlier ops create, so use your own `height` array for anything you
generate.

## WorldEdit terrain (alternative)

Use it when you want `//smooth`, `//naturalize` or `//forest`. Sculpt on the
source sandbox (or promote a terrain-only build), then capture the result as
the site of the settlement build so `ctx.site.heightAt` sees it.

```bash
toolkit mc we --world world --pos1 0,-63,0 --pos2 95,-20,95 \
  "//generate -r stone y <= -61 + 8*perlin(7, x*0.04, 0, z*0.04, 1, 3, 0.5) + 20*exp(-((x-48)^2+(z-40)^2)/400)"
toolkit mc we --world world --pos1 0,-63,0 --pos2 95,-20,95 "//smooth 3"
toolkit mc we --world world --pos1 0,-63,0 --pos2 95,-20,95 "//naturalize"
toolkit mc we --world world --pos1 0,-63,0 --pos2 95,-58,95 "//replace air water"
toolkit mc we --world world --pos1 60,-63,0 --pos2 95,-20,40 "//forest oak 4"
```

- `//generate` needs `-r` for block coordinates; without it x/y/z are
  normalized to −1..1 and the op usually creates 0 blocks.
- `//generate` overwrites every cell where the expression holds, terrain
  included; add water or fills with `//replace air <pattern>`.
- `//forest <type> <density%>` (2–6 looks natural) and `//flora <density%>`
  plant only on grass inside the box.

## Variety at scale

- Write small helpers (`house(at, w, d, floors, roof, palette, facing)`,
  `tower(...)`, `wallRun(...)`) and a layout list; give each entry its own
  size, floor count, roof type (gable, hip, mansard, conical), facing,
  palette and details. Never stamp the same house twice.
- Streets follow contours with slab or stair steps; mix `dirt_path`, `gravel`,
  `cobblestone` and `mossy_cobblestone` with `mat.noise`; lamps every ~8.
- Walls trace the terrain with towers at turns and a gatehouse on the main
  street. Landscaping is half the result: gardens, hedges, fields, docks,
  boats, carts, stalls (`library use market-stall`), wells (`plaza-well`).

## Reviewing a map

The full contact sheet shows composition: relief, focal point, districts, open
space. Then render each district up close and critique it with the rubric:

```bash
toolkit mc build render <dir> 30,-64,40 60,-20,70 --name harbor
```

Report the composition and the weakest district in the self-critique.
