import { type BlockGrid, FACE_NEIGHBORS, type Vec3 } from "#src/core/grid.ts";
import type { BlockRegistry } from "#src/registry/registry.ts";

/** Complete state emission, with game or renderer-model transmission metadata. */
export function blockLightLevels(
  grid: BlockGrid,
  options: {
    registry: BlockRegistry;
    transmission?: ReadonlyMap<string, boolean>;
  },
): Int8Array {
  const palette = grid.palette.map((state) => {
    const lighting = options.registry.lighting(state);
    if (options.transmission === undefined) return lighting;
    const transmits = options.transmission.get(state);
    if (transmits === undefined)
      throw new Error(`Missing light transmission for ${state}`);
    return { ...lighting, transmits };
  });
  const light = new Int8Array(grid.volume);
  const queue: Vec3[] = [];
  grid.forEach((x, y, z) => {
    const index = grid.index(x, y, z);
    const value = palette[grid.data[index] ?? 0];
    if (value === undefined)
      throw new Error("block-light palette entry missing");
    if (value.emission > 0) {
      light[index] = value.emission;
      queue.push({ x, y, z });
    }
  });
  for (const p of queue) {
    const level = light[grid.index(p.x, p.y, p.z)] ?? 0;
    for (const n of FACE_NEIGHBORS) {
      const q = { x: p.x + n.x, y: p.y + n.y, z: p.z + n.z };
      if (!grid.inBounds(q.x, q.y, q.z)) continue;
      const index = grid.index(q.x, q.y, q.z);
      const value = palette[grid.data[index] ?? 0];
      if (value === undefined)
        throw new Error("block-light palette entry missing");
      if (value.transmits && (light[index] ?? 0) < level - 1) {
        light[index] = level - 1;
        queue.push(q);
      }
    }
  }
  return light;
}
