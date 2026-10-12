import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";
import { ramparts } from "@shepherdjerred/mc-build/components/ramparts/index.ts";

/** A closed wall circuit over rolling ground with corner towers and a gate. */
export default ((ctx) => {
  const ground = (x: number, z: number) =>
    2 + Math.round(ctx.noise(x, z, { scale: 20, octaves: 2, salt: 3 }) * 5);
  for (let x = 0; x < 56; x += 1) {
    for (let z = 0; z < 56; z += 1) {
      const h = ground(x, z);
      for (let y = 0; y <= h; y += 1) {
        ctx.set(x, y, z, y === h ? "grass_block" : "dirt");
      }
    }
  }
  ramparts(ctx, {
    points: [
      [8, 8],
      [46, 10],
      [48, 44],
      [10, 46],
    ],
    closed: true,
    ground,
    gate: { segment: 1 },
  });
}) satisfies BuildProgram;
