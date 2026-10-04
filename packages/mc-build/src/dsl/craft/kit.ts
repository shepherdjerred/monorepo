import type { BuildCanvas } from "#src/dsl/canvas.ts";
import type { Mat } from "#src/dsl/mat.ts";
import type { Dir, Material, Site, Vec3 } from "#src/dsl/types.ts";

/** Footprint of a building: origin corner plus width (x) and depth (z). */
export type Footprint = { x: number; z: number; w: number; d: number };

/** What every craft module builds with. */
export type CraftKit = {
  canvas: BuildCanvas;
  mat: Mat;
  site: Site | null;
  put: (p: Vec3, material: Material) => void;
};

export function createKit(
  canvas: BuildCanvas,
  mat: Mat,
  site: Site | null,
): CraftKit {
  return {
    canvas,
    mat,
    site,
    put: (p, material) => {
      canvas.set(p.x, p.y, p.z, material);
    },
  };
}

/** The slab that pairs with a stairs block (`oak_stairs` → `oak_slab`). */
export function slabFor(stairs: string): string {
  return stairs.replace(/_stairs(?:\[.*)?$/u, "_slab");
}

/** Direction from the center a cell lies toward (larger axis wins). */
export function outward(dx: number, dz: number): Dir {
  if (Math.abs(dx) >= Math.abs(dz)) {
    return dx >= 0 ? "right" : "left";
  }
  return dz >= 0 ? "front" : "back";
}
