# Shared components

Reusable, pure helpers that build programs import. List them first; write
your own only for what no component covers.

```bash
toolkit mc build component ls [--tag t] [--text s]
toolkit mc build component show <name>      # exports, demo, source
```

```ts
import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";
import {
  heightfield,
  surface,
  carveRiver,
  path,
} from "@shepherdjerred/mc-build/components/terrain/index.ts";
import { house } from "@shepherdjerred/mc-build/components/house/index.ts";
import { ramparts } from "@shepherdjerred/mc-build/components/ramparts/index.ts";
import {
  boulder,
  scatterRocks,
} from "@shepherdjerred/mc-build/components/rocks/index.ts";
import { plaza } from "./lib/plaza.ts"; // your own helper, inside the build dir
```

| Component  | Use it for                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `terrain`  | `heightfield` over `ctx.noise`; `carveRiver` (before `surface`); `surface` (rock on steep, soil, shore, snow, water to sea level); `path` after `surface` (wandering, nibbled, slab steps) |
| `rocks`    | `boulder` (lumpy or tall, sunk, satellites, five palettes); `scatterRocks` over an area, skipping occupied cells                                                                           |
| `house`    | `house(ctx, { x, z, y, style, seed, … })`: a different house per seed (storeys, roof, wing, jetty, porch, chimney); returns `door` and `footprints` for plots and paths                    |
| `ramparts` | Terrain-following walls along points (`closed`, `gate`), crenellations, buttresses, corner towers, gatehouse; returns `gate` and wall `cells`                                              |

- Components take `ctx` and are pure; pass `field.at` as `ground` so walls,
  rocks and houses sit on generated terrain, and record plots in
  `field.occupied` so trees and rocks avoid them.
- Vary every call (`seed`, `style`, size): a street of `house` calls with
  the same seed is a row of clones.
- Your helpers go in the build dir (`./lib/*.ts`) and follow the same rules
  (no `Math.random`, `Date`, I/O; only component or relative imports).

## Proposing a component

When a helper is reusable (a market stall row, a bridge, a dock), propose
it and mention it in your report; a reviewed PR makes it shared:

```bash
toolkit mc build component propose <dir> lib/dock.ts --name dock \
  --description "Timber dock with piles, crates and a crane" --tag harbor
```

It copies the file (self-contained apart from components) to
`packages/mc-build/components/<name>/`, writes `meta.json`, derives
`demo.ts` from your build program, renders `demo.png` and prints the
checklist (look at the render, describe exports, add a test).
