// Original ray writer 0x1734a30, isolated CPU geometry. This module does not
// admit primitives, simulate particles, resolve materials, or infer placement.
import { directTrailHalf } from "./latest-direct-effect-trail.mjs";
const f = Math.fround;
const finite = (v) => typeof v === "number" && Number.isFinite(f(v));
const vec = (v, n) => v?.length === n && Array.from(v).every(finite);
const normalize = (a) => {
  const square = f(f(f(a[0] * a[0]) + f(a[1] * a[1])) + f(a[2] * a[2]));
  if (square <= f(1e-9)) return a;
  const inverse = f(1 / f(Math.sqrt(square)));
  return a.map((v) => f(v * inverse));
};
const cross = (a, b) => [
  f(f(a[1] * b[2]) - f(a[2] * b[1])),
  f(f(a[2] * b[0]) - f(a[0] * b[2])),
  f(f(a[0] * b[1]) - f(a[1] * b[0])),
];
const colorByte = (v) =>
  v >= 1 ? 255 : v <= 0 ? 0 : Math.trunc(f(f(v * 255) + f(0.5)));

export function directRayGeometry(input) {
  const {
    count,
    positions,
    axes,
    attributes,
    viewPosition,
    systemScale,
    colorMultiplier,
    blendMode,
    projectionScroll,
    uvScale,
    emitterUv,
    baseUvPresent,
    multUvPresent,
    multTexturePresent,
  } = input;
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    count > 1024 ||
    !(positions instanceof Float32Array) ||
    !vec(positions, count * 3) ||
    !(axes instanceof Float32Array) ||
    !vec(axes, count * 3) ||
    !(attributes instanceof Float32Array) ||
    !vec(attributes, count * 11) ||
    !vec(viewPosition, 3) ||
    !vec(systemScale, 2) ||
    !vec(colorMultiplier, 4) ||
    !vec(uvScale, 2) ||
    !vec(emitterUv, 2) ||
    ![0, 1, 4].includes(blendMode) ||
    projectionScroll !== 0 ||
    baseUvPresent !== false ||
    multUvPresent !== false ||
    multTexturePresent !== false
  )
    throw Error(
      "Explicit finite ray inputs with native zero projection-scroll policy required",
    );
  const vertices = new Uint8Array(count * 112),
    indices = new Uint16Array(count * 6);
  const data = new DataView(vertices.buffer),
    scale = f(f(systemScale[0]) * f(systemScale[1]));
  const corners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  // Original writer walks the retained pool backwards. This affects blending.
  for (let out = 0; out < count; out++) {
    const slot = count - out - 1,
      k = slot * 11,
      p = slot * 3;
    const center = Array.from(positions.subarray(p, p + 3));
    // The native SECOND particle transform supplies translation at +0x80 and
    // orientation's third column at +0x70. These are not two world endpoints.
    // Preserve the original subtraction/reconstruction, including cancellation.
    const base = center.map((v, i) => f(v - axes[p + i]));
    const direction = center.map((v, i) => f(v - base[i]));
    const side = normalize(
      cross(
        direction,
        Array.from(viewPosition, (v, i) => f(v - base[i])),
      ),
    );
    const along = normalize(direction);
    const width = f(attributes[k + 5] * scale),
      length = f(attributes[k + 6] * scale),
      offset = f(attributes[k + 7] * scale);
    let rgba = colorMultiplier.map((v, lane) =>
      f(v * attributes[k + 1 + lane]),
    );
    if (blendMode === 0)
      rgba = [
        f(rgba[0] * rgba[3]),
        f(rgba[1] * rgba[3]),
        f(rgba[2] * rgba[3]),
        1,
      ];
    const packed = [rgba[2], rgba[1], rgba[0], rgba[3]].map(colorByte);
    const start = center.map((v, lane) => f(v + f(along[lane] * offset)));
    const end = start.map((v, lane) => f(v + f(along[lane] * length)));
    for (let corner = 0; corner < 4; corner++) {
      const at = (out * 4 + corner) * 28;
      for (let lane = 0; lane < 3; lane++) {
        const halfWidth = f(f(side[lane] * width) * f(0.5));
        const anchor = corner < 2 ? end[lane] : start[lane];
        data.setFloat32(
          at + lane * 4,
          corner === 0 || corner === 3
            ? f(anchor - halfWidth)
            : f(anchor + halfWidth),
          true,
        );
      }
      vertices.set(packed, at + 12);
      const uv = [
        f(f(corners[corner][0] * uvScale[0]) + emitterUv[0]),
        f(f(corners[corner][1] * uvScale[1]) + emitterUv[1]),
        attributes[k],
        attributes[k + 10],
        attributes[k + 8],
        attributes[k + 9],
      ];
      uv.forEach((v, lane) =>
        data.setUint16(at + 16 + lane * 2, directTrailHalf(v), true),
      );
    }
    indices.set(
      [0, 1, 2, 0, 2, 3].map((v) => v + out * 4),
      out * 6,
    );
  }
  return { vertices, indices };
}
