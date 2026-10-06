import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";
import { house } from "@shepherdjerred/mc-build/components/house/index.ts";

/** Six seeded houses on one street: no two share massing, roof or palette. */
export default ((ctx) => {
  ctx.fill({ x: 0, y: 0, z: 0, w: 72, h: 1, d: 44 }, "grass_block");
  const styles = [
    "medieval",
    "tudor",
    "rustic",
    "nordic",
    "stone",
    "desert",
  ] as const;
  styles.forEach((style, i) => {
    house(ctx, {
      x: 6 + (i % 3) * 22,
      z: 4 + Math.floor(i / 3) * 22,
      y: 1,
      style,
      seed: 3 + i * 5,
    });
  });
}) satisfies BuildProgram;
