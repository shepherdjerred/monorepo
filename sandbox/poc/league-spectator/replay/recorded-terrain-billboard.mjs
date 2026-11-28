import { directPackedColor } from "./latest-direct-effect-math.mjs";
import { directTrailHalf } from "./latest-direct-effect-trail.mjs";

const f = Math.fround;
const corners = [
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

function sampleCurve(keys, t) {
  const upper = keys.findIndex(([time]) => time > t);
  if (upper === -1) return keys.at(-1)[1];
  if (upper === 0) return keys[0][1];
  const [start, from] = keys[upper - 1];
  const [end, to] = keys[upper];
  const weight = f(f(t - start) / f(end - start));
  return from.map((value, lane) => f(value + f(f(to[lane] - value) * weight)));
}

// The admitted positive-age .8428 quad uses a fixed center and static UVs.
// Its renderer still owns the camera basis, material and depth state.
export function evaluateRecordedBillboard(
  { centerY, lifetime, blend, billboard },
  ageSeconds,
) {
  const age = f(ageSeconds);
  const t = f(age / lifetime);
  const { birthScale, birthColor, scale, color } = billboard;
  const size = sampleCurve(scale, t).map((value, lane) =>
    f(value * birthScale[lane]),
  );
  const rgba = sampleCurve(color, t).map((value, lane) =>
    f(value * birthColor[lane]),
  );
  if (blend === "one-one") {
    for (let lane = 0; lane < 3; lane++) rgba[lane] = f(rgba[lane] * rgba[3]);
    rgba[3] = 1;
  }
  const packedColor = directPackedColor(rgba);
  const paletteU = directTrailHalf(t);
  const bytes = new Uint8Array(112);
  const view = new DataView(bytes.buffer);
  for (const [index, [right, up]] of corners.entries()) {
    const offset = index * 28;
    view.setFloat32(offset, right * size[0], true);
    view.setFloat32(offset + 4, f(centerY + up * size[1]), true);
    bytes.set(packedColor, offset + 12);
    view.setUint16(offset + 16, up > 0 ? 0x3c00 : 0, true);
    view.setUint16(offset + 18, right < 0 ? 0x3c00 : 0, true);
    view.setUint16(offset + 24, paletteU, true);
    view.setUint16(offset + 26, 0x3c00, true);
  }
  return bytes;
}
