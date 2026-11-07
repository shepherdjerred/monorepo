import type { TerrainPatch } from "./define.ts";

export function* patchColumns(
  patch: TerrainPatch,
): Generator<[number, number]> {
  for (
    let x = Math.floor(patch.min[0] / 16) - patch.paddingChunks;
    x <= Math.floor(patch.max[0] / 16) + patch.paddingChunks;
    x++
  )
    for (
      let zz = Math.floor(patch.min[1] / 16) - patch.paddingChunks;
      zz <= Math.floor(patch.max[1] / 16) + patch.paddingChunks;
      zz++
    )
      yield [x, zz];
}
export function includesChunk(
  patches: TerrainPatch[],
  world: string,
  x: number,
  zz: number,
): boolean {
  return patches.some(
    (p) =>
      p.world === world &&
      x >= Math.floor(p.min[0] / 16) - p.paddingChunks &&
      x <= Math.floor(p.max[0] / 16) + p.paddingChunks &&
      zz >= Math.floor(p.min[1] / 16) - p.paddingChunks &&
      zz <= Math.floor(p.max[1] / 16) + p.paddingChunks,
  );
}
export function columnKey(world: string, x: number, zz: number): string {
  return `${world}:${x.toString()}:${zz.toString()}`;
}
export function verifyCoverage(
  patches: TerrainPatch[],
  terrain: Set<string>,
): void {
  for (const patch of patches)
    for (const [x, zz] of patchColumns(patch))
      if (!terrain.has(columnKey(patch.world, x, zz)))
        throw new Error(
          `Missing saved terrain ${columnKey(patch.world, x, zz)}`,
        );
}
