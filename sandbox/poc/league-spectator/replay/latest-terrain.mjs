// Exact 16.21 ground-height query: wrapper 0x16ba3b0, sampler 0x16bb220.
// This is navgrid ground height, not collision, water displacement or rendering.
import { latestMovementOrigin } from "./latest-movement.mjs";

export function createLatestTerrain(manifest, heights) {
  const map = manifest.map,
    grid = map?.heightGrid,
    f = Math.fround;
  if (
    manifest.build !== "16.21.829.8620" ||
    manifest.protocol !== "20e09df23c66b85e" ||
    !grid ||
    ![grid.x, grid.z].every((n) => Number.isInteger(n) && n >= 2) ||
    !Array.isArray(map.min) ||
    map.min.length !== 3 ||
    !Array.isArray(map.max) ||
    map.max.length !== 3 ||
    ![...map.min, ...map.max].every((n) => Number.isFinite(n) && f(n) === n) ||
    !Array.isArray(grid.step) ||
    grid.step.length !== 2 ||
    !grid.step.every((n) => Number.isFinite(n) && n > 0 && f(n) === n) ||
    !Array.isArray(map.movementOrigin) ||
    map.movementOrigin.length !== 2 ||
    !map.movementOrigin.every(Number.isInteger) ||
    map.max[0] <= map.min[0] ||
    map.max[2] <= map.min[2] ||
    !(heights instanceof Float32Array) ||
    heights.length !== grid.x * grid.z ||
    !heights.every(Number.isFinite)
  )
    throw Error("Invalid or incompatible native terrain package");
  // Native indexing is signed32. Reject invalid package dimensions once, before
  // any query can turn malformed data into a plausible ground height.
  if (
    heights.length > 0x7fffffff ||
    f(f(map.max[0] - map.min[0]) / grid.step[0]) >= grid.x ||
    f(f(map.max[2] - map.min[2]) / grid.step[1]) >= grid.z
  )
    throw Error("Height samples do not cover the declared map bounds");
  const origin = latestMovementOrigin(map.min, map.max);
  if (origin.some((n, lane) => n !== map.movementOrigin[lane]))
    throw Error("Terrain movement origin differs from native initializer");
  // 0x16b3570 compares quantized X/Z cells. Preserve CVTTPS2DQ's invalid
  // conversion value, PACKSSDW saturation and the low signed word comparison.
  const int32 = (n) =>
    n >= 0x80000000 || n < -0x80000000 ? -0x80000000 : Math.trunc(n);
  function sameMovementCell(first, second) {
    if (
      first.length !== 3 ||
      second.length !== 3 ||
      ![...first, ...second].every(Number.isFinite)
    )
      throw Error("Invalid positions for native movement-cell comparison");
    for (const [lane, center] of [
      [0, origin[0]],
      [2, origin[1]],
    ]) {
      const a = int32(f(f(f(first[lane]) - center) / 2)),
        b = int32(f(f(f(second[lane]) - center) / 2)),
        saturated = Math.min(32767, Math.max(-32768, a)),
        lowWord = (b << 16) >> 16;
      if (saturated !== lowWord) return false;
    }
    return true;
  }
  function sampleHeight(x, z) {
    if (![x, z].every(Number.isFinite)) throw Error("Non-finite terrain query");
    x = f(x);
    z = f(z);
    if (x < map.min[0] || x > map.max[0] || z < map.min[2] || z > map.max[2])
      return { inside: false, height: null };
    const gx = f(f(x - map.min[0]) / grid.step[0]),
      gz = f(f(z - map.min[2]) / grid.step[1]),
      ix = Math.trunc(gx),
      iz = Math.trunc(gz),
      edgeX = ix >= grid.x - 1,
      edgeZ = iz >= grid.z - 1,
      lowX = ix - Number(edgeX),
      highX = ix + Number(!edgeX),
      lowZ = iz - Number(edgeZ),
      highZ = iz + Number(!edgeZ),
      indices = [
        lowZ * grid.x + lowX,
        lowZ * grid.x + highX,
        highZ * grid.x + lowX,
        highZ * grid.x + highX,
      ];
    if (indices.some((index) => index < 0 || index >= heights.length))
      throw Error("Native terrain query escaped validated grid");
    const u = edgeX ? 1 : f(gx - f(ix)),
      v = edgeZ ? 1 : f(gz - f(iz)),
      cu = f(1 - u),
      cv = f(1 - v),
      lower = f(
        f(f(heights[indices[0]] * cu) + f(heights[indices[1]] * u)) * cv,
      ),
      upper = f(
        v * f(f(heights[indices[2]] * cu) + f(heights[indices[3]] * u)),
      ),
      height = f(upper + lower);
    if (!Number.isFinite(height)) throw Error("Invalid native ground height");
    return { inside: true, height };
  }
  function height(x, z) {
    const result = sampleHeight(x, z);
    if (!result.inside) throw Error("Position outside prepared map bounds");
    return result.height;
  }
  return { sampleHeight, height, sameMovementCell };
}
