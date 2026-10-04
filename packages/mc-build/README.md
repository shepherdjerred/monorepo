# @shepherdjerred/mc-build

Pure library behind `toolkit mc build`: the Minecraft 26.2 block registry,
block grids, Sponge schematics, the build DSL, lint, and an offline renderer.
It never talks to a server; mc-harness wires it to sandboxes through the
daemon.

## Layout

| Path            | What it is                                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/registry/` | Committed `generated/blocks-26.2.json` (ids, property enums, defaults) and `BlockRegistry` validation with suggestions                                            |
| `src/core/`     | Block-state parsing, `BlockGrid` (palette + YZX `Uint32Array`), Sponge v3 `.schem` read/write, region-read decoding, site analysis (heightmap, masks, `siteHash`) |
| `src/dsl/`      | Build DSL: sparse canvas (KEEP vs explicit AIR), `geo`, `mat`, `craft`, connection pass for panes/fences/walls                                                    |
| `src/compile/`  | Runs a `build.ts` program in a child Bun process (empty env, timeout, import scan)                                                                                |
| `src/lint/`     | Findings for invalid states, floating parts, gravity, attachments, leaf decay, flat facades, monotone surfaces, dark interiors                                    |
| `src/render/`   | Software rasterizer: blockstates/models → quads → z-buffer → contact sheet PNG                                                                                    |

## DSL frame

`+x` right, `+y` up, `+z` toward the front (south at rotate 0). Boxes are
`{x, y, z, w, h, d}`. Programs are `export default ((ctx) => …) satisfies
BuildProgram` with type-only imports from `dsl/context.ts`. Compiled grids
carry their local min corner; pasting the schematic (Offset 0) at
`anchor + min` places it.

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
`bun run scripts/fetch-assets.ts` warms the cache. Golden tests use a tiny
texture pack the test authors itself, so CI needs no Mojang assets.

```bash
bun run scripts/render.ts test/fixtures/house.build.ts /tmp/house.png
bun run typecheck && bun run test && bun run lint
```
