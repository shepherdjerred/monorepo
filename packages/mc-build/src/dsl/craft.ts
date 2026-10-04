/**
 * Builder-craft primitives, one module per family under ./craft/:
 * walls (foundation, floor, walls, window, door, trim), roofs (gable, hip,
 * conical, mansard, dormer), structures (chimney, tower, porch) and furnish
 * (interior, landscape, path).
 */
import type { BuildCanvas } from "./canvas.ts";
import { furnishParts } from "./craft/furnish.ts";
import { createKit } from "./craft/kit.ts";
import { roofParts } from "./craft/roofs.ts";
import { structureParts } from "./craft/structures.ts";
import { wallParts } from "./craft/walls.ts";
import type { Mat } from "./mat.ts";
import type { Site } from "./types.ts";

export function createCraft(canvas: BuildCanvas, mat: Mat, site: Site | null) {
  const kit = createKit(canvas, mat, site);
  return {
    ...wallParts(kit),
    ...roofParts(kit),
    ...structureParts(kit),
    ...furnishParts(kit),
  };
}

export type Craft = ReturnType<typeof createCraft>;
