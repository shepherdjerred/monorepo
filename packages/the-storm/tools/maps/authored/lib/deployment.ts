import type { BuildContext } from "@shepherdjerred/mc-build/dsl/context.ts";
import { box } from "./arena.ts";

/** Theme objective courts without moving their gameplay cells or spawn clearances. */
export function deployment(
  ctx: BuildContext,
  w: number,
  d: number,
  material: string,
) {
  const z = Math.floor(d / 2);
  for (const x of [14, w - 15]) {
    box(ctx, x - 5, 8, z - 7, 11, 1, 15, material);
    box(ctx, x < w / 2 ? x - 5 : x + 5, 9, z - 5, 1, 4, 11, material);
  }
}
