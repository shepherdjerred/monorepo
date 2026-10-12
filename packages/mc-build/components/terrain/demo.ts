import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";
import {
  carveRiver,
  heightfield,
  path,
  surface,
} from "@shepherdjerred/mc-build/components/terrain/index.ts";

/** A 64×64 valley: noise hills, a ridged peak, a river to the sea, a path. */
export default ((ctx) => {
  const SEA = 4;
  const field = heightfield({
    x: 0,
    z: 0,
    w: 64,
    d: 64,
    height: (x, z) => {
      const hills = ctx.noise(x, z, { scale: 18, octaves: 3, salt: 1 });
      const ridge = ctx.noise(x, z, {
        scale: 22,
        octaves: 3,
        ridged: true,
        salt: 2,
      });
      const peak = Math.exp(-((x - 14) ** 2 + (z - 14) ** 2) / 260);
      const coast = Math.max(0, (z - 50) / 14);
      return 5 + hills * 6 + peak * ridge ** 1.4 * 26 - coast * 6;
    },
  });
  carveRiver(ctx, field, {
    points: [
      [16, 22],
      [28, 30],
      [34, 44],
      [44, 63],
    ],
    width: 3,
    depth: 2,
  });
  surface(ctx, field, { sea: SEA, snowAbove: 28 });
  path(ctx, field, {
    points: [
      [4, 60],
      [20, 46],
      [30, 36],
      [52, 24],
      [60, 8],
    ],
    width: 3,
  });
}) satisfies BuildProgram;
