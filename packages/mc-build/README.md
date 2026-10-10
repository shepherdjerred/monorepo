# @shepherdjerred/mc-build

Pure library behind `toolkit mc build`: the Minecraft 26.2 block registry,
block grids, Sponge schematics, the build DSL, lint, and an offline renderer.
It never talks to a server; mc-harness wires it to sandboxes through the
daemon.

## Layout

| Path            | What it is                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/registry/` | Committed `generated/blocks-26.2.json` (ids, property enums, defaults) and `BlockRegistry` validation with suggestions                                                                                                          |
| `src/core/`     | Block-state parsing, `BlockGrid` (palette + YZX `Uint32Array`), Sponge v3 `.schem` read/write, Litematica `.litematic` reading (multi-region, signed sizes), region-read decoding, site analysis (heightmap, masks, `siteHash`) |
| `src/dsl/`      | Build DSL: sparse canvas (KEEP vs explicit AIR), `geo`, `mat`, connection pass for panes/fences/walls; `craft.ts` merges the primitive modules in `dsl/craft/` (walls, roofs, structures, furnish)                              |
| `src/import/`   | Mesh import: OBJ/MTL parsing (colors, textures), triangle/box voxelization with optional solid fill, OKLab nearest-block palettes from the cached textures                                                                      |
| `src/library/`  | Catalog loader for `library/<slug>/{build.ts, meta.json}`: curated, lint-clean programs agents copy and adapt                                                                                                                   |
| `src/compile/`  | Runs a `build.ts` program in a child Bun process (empty env, timeout, import scan)                                                                                                                                              |
| `src/lint/`     | Findings for invalid states, floating parts, gravity, attachments, leaf decay, flat facades, monotone surfaces, dark interiors                                                                                                  |
| `src/render/`   | Software rasterizer: blockstates/models → quads → z-buffer → contact sheet PNG                                                                                                                                                  |

## DSL frame

`+x` right, `+y` up, `+z` toward the front (south at rotate 0). Boxes are
`{x, y, z, w, h, d}`. Programs are `export default ((ctx) => …) satisfies
BuildProgram` with type-only imports from `dsl/context.ts`. Compiled grids
carry their local min corner; pasting the schematic (Offset 0) at
`anchor + min` places it.

## Imports

`core/litematic.ts` reads Litematica files: regions merge into one grid
(negative `Size` extends toward smaller coordinates), and block states unpack
from longs packed without padding at `max(2, ceil(log2(palette)))` bits, as
Litematica's `LitematicaBitArray` writes them. `import/` turns an OBJ into a
grid `height` blocks tall: every voxel a triangle touches takes the color
the mesh shows at its closest point (MTL `Kd` or `map_Kd` texture), `solid`
fills space a flood fill from outside cannot reach, and colors map to the
perceptually nearest block of a curated palette (`default`, `wool`,
`concrete`, `terracotta`). Palette colors are texture averages computed from
the cached client jar and cached under `~/.cache/toolkit/mc/palettes`.

## Registry

Generated from a live MCBridge `/v1/registry`; regenerate on every Paper bump
(the version test fails otherwise):

```bash
toolkit mc registry --out /tmp/registry.json      # against a running sandbox
bun run --cwd packages/mc-harness gen-registry /tmp/registry.json
```

## Renderer assets

Block models and textures come from Mojang's 26.2 client jar, downloaded from
piston-meta on first render, sha1-verified, and cached in
`~/.cache/toolkit/mc/assets/26.2`. They are never committed.
Concurrent first renders use separate staging directories and atomically publish
a complete pack; they never remove a cache another renderer is using.
`bun run scripts/fetch-assets.ts` warms the cache. Golden tests use a tiny
texture pack the test authors itself, so CI needs no Mojang assets.

```bash
bun run scripts/render.ts test/fixtures/house.build.ts /tmp/house.png
bun run scripts/render.ts out/site.schem /tmp/sheet.png --judge-sheet /tmp/judge.png --kind micro --label A
bun run typecheck && bun run test && bun run lint
```

Every view can be drawn `textured` (default), in `value` (grays: tonal
massing and silhouette), `normal` (each face coloured by its facing, so a
flat wall is one flat colour and relief shows as colour changes), `squint`
(box-blurred: only massing survives), `relief` (a low sun marched through
the grid for long shadows, plus corner occlusion) or `light` (cells coloured
by block light with sky light propagated in; level 0 is red). Invisible
`minecraft:light` blocks emit their `level` (0–15, default 15) while transmitting
skylight, for example
`renderer.view(grid, "iso-front-right", 512, { mode: "relief" })`.
Ordinary and stained glass, including panes, transmit skylight; tinted glass
and solid blocks obstruct it. The skylight pass is an approximation within
the captured grid. For cut or cropped light views, pass `lightFrom: whole`
and `lightOrigin: { x, y, z }` (the cropped grid's origin in `whole`) so
surrounding roofs, walls, lamps and openings still determine illumination.
For close-ups in any mode, also pass `cropFrom: { grid: whole, box }`:
the renderer shades and culls the whole geometry before selecting the box's
faces. This retains outside relief shadows and avoids invented crop-edge
faces. Apply deliberate floor or section cuts to that geometry first, and
retain the uncut grid as `lightFrom`.
Beyond
the contact sheet: `renderer.elevations(grid, { grid: 8 })` (front, right,
back, left and top with coordinate lines), `renderer.pov(grid)` (a
perspective eye-level view from in front of the build, `camera.ts`
`perspectiveProjector`; default framing ignores empty layers above the build),
`renderer.compare(before, after)` (side by side
plus a plan of changed columns, with one shared occupied height for both panels),
`renderer.survey(grid)` (a map tiled at
readable scale with an index), `drawGridOverlay`, and `render/cut.ts`
(`cutGrid` for floor plans and sections, `namedCrop` for fixed close-ups).
`scripts/render-modes.ts` draws every look of one program on one page. The
**judge sheet** (`src/render/judge-sheet.ts`) is the fixed, anonymised
layout vision judges see — hero, plan, value and normal views plus close-ups
at twice the scale, titled only with a letter — in a `micro` (one building)
or `map` (settlement) arrangement. `src/lint/repetition.ts` measures how much
of a grid is copy-pasted (hashed 8×8×8 cubes); the harness evals use it.
Pass `{ baseline: site }` to measure changed cells, including excavations,
instead of the final blocks. The grids must have identical dimensions;
`minFilled` then counts edits, and repeated removals count as repetition.

## Components

`components/<name>/{index.ts, demo.ts, meta.json, demo.png}` are pure
helpers build programs import as
`@shepherdjerred/mc-build/components/<name>/index.ts` (the compile child maps
that specifier with a resolver plugin, so build dirs outside the workspace
work). `src/compile/scan.ts` walks a program's imports: only components and
relative `.ts` files inside the build dir (or the components library) are
allowed, and every file gets the same purity scan. `src/catalog/components.ts`
lists them (`ComponentMetaSchema`: name, description, tags, exports). Agents
propose new ones with `toolkit mc build component propose`; a PR with a test
and the reviewed `demo.png` makes them shared. Re-render a demo with
`toolkit mc build component render <name>`.

## Library

Each `library/<slug>/` holds a `build.ts` program and a `meta.json` (title,
kebab-case tags, style, footprint, notes) validated by `LibraryMetaSchema`.
Tests compile every entry twice and require identical grids and zero lint
findings. After editing an entry, render and look at it:

```bash
bun run scripts/library-report.ts /tmp/library [slug…]   # lint + contact sheets
bun run scripts/lint-program.ts library/cottage/build.ts
```
