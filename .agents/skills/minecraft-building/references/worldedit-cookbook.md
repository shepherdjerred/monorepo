# WorldEdit cookbook (via `toolkit mc we`)

Every op runs as a per-session agent actor with explicit coordinates. The
bridge sets the world, then `--pos1`/`--pos2` (the selection), then `--at`
(placement position for shape commands) before the command runs.

```bash
toolkit mc we --target <canvas> --record <dir> --world world \
  --pos1 10,-60,10 --pos2 20,-56,18 "//walls stone_bricks"
toolkit mc we --target <canvas> --record <dir> --world world --at 15,-50,14 "//sphere oak_leaves[persistent=true] 3"
```

## Patterns (what to place)

- Single block with state: `oak_stairs[facing=east,half=top]`
- Weighted mix (texture): `60%stone_bricks,25%cracked_stone_bricks,15%andesite`
  — random, so `build replay` flags it; promote still applies the frozen canvas.
- Deterministic alternative: author textures in `build.ts` with `mat.noise` or
  `mat.palette` (seeded per cell).

## Masks (where to place)

- `//replace grass_block dirt_path` — only replace matching blocks in the selection.
- `//replace !air stone` — everything that is not air.
- `//overlay moss_carpet` — on top of the highest block in each column.

## Region commands (selection = pos1..pos2)

| Command                             | Use                                                       |
| ----------------------------------- | --------------------------------------------------------- |
| `//set <pattern>`                   | Fill the box (floors, slabs of terrain, clear with `air`) |
| `//walls <pattern>`                 | Four side walls of the box                                |
| `//faces <pattern>`                 | All six faces (hollow box)                                |
| `//replace <mask> <pattern>`        | Swap materials (weathering, paths)                        |
| `//overlay <pattern>`               | Ground cover on the top surface                           |
| `//smooth [iterations]`             | Soften terrain heightmap in the box                       |
| `//naturalize`                      | Grass on top, dirt below, stone deeper                    |
| `//stack <count> [direction]`       | Repeat the selection (colonnades, fences, windows)        |
| `//move <count> [direction]`        | Shift the selection                                       |
| `//generate <pattern> <expression>` | Math shapes, e.g. arches/domes (`y < 3*sin(x/4)`)         |

## Shape commands (placement = `--at`)

| Command                                | Use                    |
| -------------------------------------- | ---------------------- |
| `//sphere <pattern> <r>` / `//hsphere` | Tree canopies, domes   |
| `//cyl <pattern> <r> [h]` / `//hcyl`   | Towers, wells, columns |
| `//pyramid <pattern> <size>`           | Spires, cairns         |

## Tips

- Undo the last ops on the canvas: `toolkit mc we-undo --target <canvas> --steps 2`
  — but also remove them from `build.oplog.json`, or simply re-run
  `toolkit mc build run <dir>` after editing the log.
- Stairs `facing` = the direction you walk up; `half=top` for upside-down
  (eaves, sills, corbels).
- Fences, panes and walls placed by WorldEdit don't connect to neighbours; the
  DSL computes connections for you.
