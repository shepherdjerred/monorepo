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
array, so buildings sit on the terrain you generated. Build heights from
`ctx.noise(x, z, { scale, octaves, ridged, salt })` (deterministic fractal
noise in [0, 1)), not summed sine waves, which repeat and band:

```ts
const N = 96;
const SEA = 6;
const height: number[][] = []; // local y of the ground surface per (x, z)
for (let x = 0; x < N; x++) {
  height[x] = [];
  for (let z = 0; z < N; z++) {
    // island mask: radial falloff with a noisy, indented coastline
    const r = Math.hypot((x - 48) / 42, (z - 48) / 38);
    const coast =
      r + (ctx.noise(x, z, { scale: 22, octaves: 3, salt: 1 }) - 0.5) * 0.7;
    const land = Math.max(0, Math.min(1, (1 - coast) * 2.2));
    // a ridged peak off-centre, rolling hills elsewhere
    const focus = Math.exp(-((x - 36) ** 2 + (z - 34) ** 2) / 500);
    const ridge = ctx.noise(x, z, {
      scale: 26,
      octaves: 3,
      ridged: true,
      salt: 2,
    });
    const hills = ctx.noise(x, z, { scale: 20, octaves: 2, salt: 3 });
    height[x]![z] = Math.round(
      SEA - 3 + land * (4 + hills * 6 + focus * ridge ** 1.5 * 34),
    );
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
- Pick surface blocks by slope and height, not only by layer: rock where a
  column is 2+ blocks above a neighbour, coarse dirt, moss and gravel patches
  from a second `ctx.noise` field, sand near sea level. Uniform grass on a
  smooth field reads as regular one-block stripes.
- Shape terrain on purpose: add cliffs, buttresses, scree and a second peak
  to break a smooth cone; carve a valley or harbor; vary beach width.
- `Math.hypot`, `Math.exp` and friends are fine; `Math.random` is not (use
  `ctx.noise` for fields and `ctx.rng()` for scatter).

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

## Settlements

- Purpose first: why the town exists (port, crossing, mine, fort, farms)
  shows in its site, props and farms. Forts sit at passes, capes and hills
  over rivers; harbours on real coast.
- Build order: landmark → road network → plots along roads → houses → walls
  last. One main street (5–7 wide) runs to the square; lanes 3–4, alleys
  1–2; a road 7+ wide never turns 90°. Plazas sit at junctions.
- Density falls off outward: an attached 2–4-storey core, a ring of
  detached houses with yards, scattered farmsteads beyond. About 60% of
  buildings are housing; landmarks are 2–3× the eave height and never
  outnumber houses.
- One culture and roof style per town; vary houses by pitch, height,
  storeys, jetties, wall colour, frame pattern, chimney side, door side and
  wings. Write helpers (`house(at, w, d, floors, roof, palette, facing)`)
  and a layout list; never stamp the same house twice.
- Walls 3–4 thick at the base, towers 2–3 wider than the wall at corners and
  flanking a 4–5 tall, 3–4 wide gate; buttresses every 8–10; most farmland
  outside the walls.
- Docks first (the shore is fixed): timber deck at water level, stone quay
  above, `dark_oak_log` piles; cranes, crates, ships of several sizes.
- Farms: many small fields with contour hedgerows and trees, terraces on
  slopes, farmhouses among them.
- Storytelling props in moderation: carts, stalls, barrels, hay, window
  boxes, banners, a laundry line, one construction site.
- Light entrances, the main road and the square with lantern posts every
  8–10; leave deliberate dark between, hide other sources.
- Use `craft.tree` for every tree and see landscape.md for paths, banks and
  planting; craft.md for building shape, depth and roofs; palettes.md for
  blocks.

## Composition

- Macro → meso → micro: terrain and water, roads and zoning, foundations,
  the largest buildings, infill, then hedges, trees and props.
- Leading lines (roads, rivers, walls) point at the landmark; it is visible
  from every main approach.
- Calm areas (meadow, water, plaza) between dense clusters so detail reads;
  texture strips between roads and buildings lightly rather than leaving
  bare grass.
- Clear size tiers: landmark > civic and commercial > houses > sheds; vary
  the skyline across each district.
- Transitions are gradients: vegetation densest along water, thinning into
  plains and near settlements; districts and biomes blend over 10–30 blocks.
- Repeats get edits: any prop seen 10+ times needs ~10 variants; rotate and
  mirror tree and house variants.

## Large maps (150–500 blocks)

- Keep the site box tight vertically (lowest ground to the tallest spire plus
  a few blocks); volume drives every read, render and paste.
- Plan zones on a coarse grid (about 50-block cells): mountains, river,
  forest, farmland, each settlement, the landmark. Write terrain as one
  heightfield first, then settlements as functions placed by a layout list.
- Rivers run downhill: carve a channel whose bed drops steadily from source
  to mouth, widen it near the end, and bridge every road that crosses it.
- Roads follow contours between settlements; switchback up steep ridges.
- Spend detail where the eye goes (villages, castle, harbor) and keep the
  land between them simpler: forests, fields, meadows and rock.
- Reads, snapshots, compile pastes and promote split into tiles
  automatically past ~3.6M blocks; nothing changes in the commands. The
  whole-site sheet and hero are overviews at this size; critique districts
  with close-up renders.

## Reviewing a map

`build render` also writes `<name>-hero.png`, one large isometric view, for
sites 48+ blocks wide. Judge composition there, then render each district up
close and critique it with the building rubric:

```bash
toolkit mc build render <dir> 30,-64,40 60,-20,70 --name harbor
```

Score the map itself 0–2 on each of these, and fix the lowest first:

| Aspect      | 2 looks like                                                             |
| ----------- | ------------------------------------------------------------------------ |
| Relief      | Terrain reads in the hero view: a clear high point, slopes, edges        |
| Focal point | One landmark dominates and the eye travels to it along streets or coast  |
| Variety     | Buildings differ in size, height, roof and palette; 2–3 large landmarks  |
| Open space  | 30–40% unbuilt ground: plazas, gardens, fields, cliffs, water            |
| Palette     | Warm roofs and greenery balance stone; walls are not the dominant colour |
| Terrain     | Irregular coast and contours, rock on steep ground, no regular bands     |
| Edges       | Walls, docks and paths meet the ground and water cleanly                 |
| Life        | Trees, crops, boats, stalls, lamps and paths make it feel inhabited      |

Report the map scores, the composition and the weakest district in the
self-critique.
