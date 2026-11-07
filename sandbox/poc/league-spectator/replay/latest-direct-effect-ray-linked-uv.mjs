// Original Ray base-UV composition (1734e90..1734ed3 / 1731a50).
// Explicit retained particle transforms and UV matrices only: no emitter
// admission, atlas simulation, resource binding or placement inference.
import { directRayGeometry } from "./latest-direct-effect-ray.mjs";
import { directTrailHalf } from "./latest-direct-effect-trail.mjs";
const f = Math.fround;
const denseFinite = (v, n) =>
  v instanceof Float32Array &&
  v.length === n &&
  Array.from(v).every((x) => Number.isFinite(x));

export function directRayLinkedGeometry(input) {
  if (
    !input ||
    !Number.isInteger(input.count) ||
    input.count < 0 ||
    input.count > 1024 ||
    input.baseUvPresent !== true ||
    input.multUvPresent !== false ||
    input.multTexturePresent !== false ||
    !denseFinite(input.baseUvMatrices, input.count * 6)
  )
    throw Error(
      "Explicit retained Ray base-UV matrices without mult texture required",
    );
  const result = directRayGeometry({ ...input, baseUvPresent: false }),
    data = new DataView(result.vertices.buffer),
    corners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
  for (let out = 0; out < input.count; out++) {
    const slot = input.count - 1 - out,
      matrix = input.baseUvMatrices.subarray(slot * 6, slot * 6 + 6),
      a = f(matrix[0] * input.uvScale[0]),
      b = f(matrix[1] * input.uvScale[1]),
      c = f(matrix[2] * input.uvScale[0]),
      d = f(matrix[3] * input.uvScale[1]),
      tx = f(matrix[4] + input.emitterUv[0]),
      ty = f(matrix[5] + input.emitterUv[1]);
    for (let corner = 0; corner < 4; corner++) {
      const [x, y] = corners[corner],
        at = (out * 4 + corner) * 28 + 16;
      data.setUint16(at, directTrailHalf(f(f(f(a * x) + f(c * y)) + tx)), true);
      data.setUint16(
        at + 2,
        directTrailHalf(f(f(f(b * x) + f(d * y)) + ty)),
        true,
      );
    }
  }
  return result;
}
