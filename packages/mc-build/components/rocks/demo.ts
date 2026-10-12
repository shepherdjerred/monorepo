import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";
import { boulder } from "@shepherdjerred/mc-build/components/rocks/index.ts";

/** Boulders of each size, shape and palette on a grass pad. */
export default ((ctx) => {
  ctx.fill({ x: 0, y: 0, z: 0, w: 48, h: 2, d: 24 }, "dirt");
  ctx.fill({ x: 0, y: 2, z: 0, w: 48, h: 1, d: 24 }, "grass_block");
  const palettes = ["stone", "mossy", "granite", "sandstone", "dark"] as const;
  palettes.forEach((palette, i) => {
    boulder(ctx, {
      x: 5 + i * 9,
      y: 3,
      z: 6,
      size: 2 + (i % 3),
      palette,
      seed: i,
    });
    boulder(ctx, {
      x: 5 + i * 9,
      y: 3,
      z: 17,
      size: 2,
      shape: "tall",
      palette,
      seed: i + 9,
    });
  });
}) satisfies BuildProgram;
