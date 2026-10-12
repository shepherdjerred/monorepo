import { BlockGrid } from "#src/core/grid.ts";
import { loadMesh } from "./obj.ts";
import { nearestBlockMatcher, type PaletteEntry } from "./palette.ts";
import { voxelize, type VoxelizeOptions } from "./voxelize.ts";

/**
 * Mesh import: an OBJ (with its MTL colors and textures) becomes a block grid
 * `height` blocks tall. Surface voxels take the nearest palette block to the
 * color the mesh shows there; `solid` also fills enclosed space.
 */

export type MeshImport = {
  grid: BlockGrid;
  triangles: number;
  surface: number;
  interior: number;
};

export async function importMesh(
  objPath: string,
  options: VoxelizeOptions & { palette: readonly PaletteEntry[] },
): Promise<MeshImport> {
  const mesh = await loadMesh(objPath);
  const voxels = voxelize(mesh, options);
  const nearest = nearestBlockMatcher(options.palette);
  const grid = new BlockGrid(voxels.size);
  const { x: sizeX, z: sizeZ } = voxels.size;
  for (const [key, color] of voxels.colors) {
    const x = key % sizeX;
    const rest = (key - x) / sizeX;
    const z = rest % sizeZ;
    grid.set(x, (rest - z) / sizeZ, z, nearest(color));
  }
  return {
    grid,
    triangles: mesh.triangles.length,
    surface: voxels.surface,
    interior: voxels.interior,
  };
}
