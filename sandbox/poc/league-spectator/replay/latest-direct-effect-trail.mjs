import { correctDirectTrailMode1 } from "./latest-direct-effect-trail-math.mjs";
import { directPackedColor } from "./latest-direct-effect-math.mjs";
export { directPackedColor as directTrailPackedColor } from "./latest-direct-effect-math.mjs";

const f = Math.fround;
const bits = new DataView(new ArrayBuffer(4));

// Original 0x1731fb0: float32 bits are rounded before exponent selection.
// This deliberately retains its overflow encoding, rather than substituting
// a platform half-float conversion with different rounding/NaN behavior.
export function directTrailHalf(value) {
  bits.setFloat32(0, value, true);
  const rounded = (bits.getUint32(0, true) + 0x1000) >>> 0;
  const exponent = (rounded >>> 23) & 255;
  const mantissa = rounded & 0x7fffff;
  let result = (rounded >>> 16) & 0x8000;
  if (exponent > 112)
    result |= (mantissa >>> 13) | (((rounded >>> 23) * 1024 + 0x4000) & 0x7c00);
  if (exponent >= 102 && exponent <= 112) {
    const shift = 125 - exponent;
    result |= (((mantissa + 0x7ff000) >>> shift) + 1) >>> 1;
  }
  if (exponent > 143) result |= 0x7fff;
  return result;
}

const sub = (a, b) => a.map((x, i) => f(x - b[i]));
const length = (v) =>
  f(Math.sqrt(f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]))));
const cross = (a, b) => [
  f(f(a[1] * b[2]) - f(a[2] * b[1])),
  f(f(a[2] * b[0]) - f(a[0] * b[2])),
  f(f(a[0] * b[1]) - f(a[1] * b[0])),
];

// CameraTrail's camera-dependent writer. Input arrays retain native pool
// order; deriving this geometry never mutates particle, RNG or odometer state.
// Admission of each mode is separate from translating its writer.
export function directTrailGeometry(input) {
  const {
    positions,
    attributes,
    tiling,
    odometer,
    count,
    mode,
    smoothingMode,
    smoothingQuality,
    textureAddressMode,
    blendMode,
    cutoff,
    viewForward,
    systemScale,
    colorMultiplier,
    emitterUv,
    uvTransform = null,
  } = input;
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    count > 1024 ||
    !(positions instanceof Float32Array) ||
    positions.length !== count * 3 ||
    !(attributes instanceof Float32Array) ||
    attributes.length !== count * 11 ||
    !(tiling instanceof Float32Array) ||
    tiling.length !== count * 2 ||
    !(odometer instanceof Float32Array) ||
    odometer.length !== count ||
    (uvTransform !== null &&
      (!(uvTransform instanceof Float32Array) ||
        uvTransform.length !== count * 6 ||
        !uvTransform.every(Number.isFinite))) ||
    ![0, 1].includes(mode) ||
    ![0, 1].includes(smoothingMode) ||
    !Number.isInteger(smoothingQuality) ||
    smoothingQuality < 0 ||
    smoothingQuality > 3 ||
    ![0, 1, 2, 3].includes(textureAddressMode) ||
    ![0, 1, 4].includes(blendMode) ||
    !Number.isFinite(f(cutoff)) ||
    cutoff < 0 ||
    [
      positions,
      attributes,
      tiling,
      odometer,
      viewForward,
      systemScale,
      colorMultiplier,
      emitterUv,
    ].some(
      (a) =>
        !a ||
        !Array.from(a).every(
          (v) => typeof v === "number" && Number.isFinite(f(v)),
        ),
    ) ||
    viewForward.length !== 3 ||
    systemScale.length !== 2 ||
    colorMultiplier.length !== 4 ||
    emitterUv.length !== 2
  )
    throw Error("Unadmitted direct CameraTrail writer input");
  const output = new Uint8Array(count * 56),
    out = new DataView(output.buffer);
  const axis = Array.from(viewForward, f),
    scales = Array.from(systemScale, f),
    multiplier = Array.from(colorMultiplier, f),
    emitterOffset = Array.from(emitterUv, f);
  const indices = new Uint16Array(Math.max(count - 1, 0) * 6);
  const joinInputs = input.includeJoinInputs ? [] : null;
  let used = 0,
    indexCount = 0,
    distance = 0,
    previous = null,
    previousOffset = [0, 0, 0],
    previousWidth = 0,
    baseU = 0,
    baseMultU = 0;
  const point = (i) => Array.from(positions.subarray(i * 3, i * 3 + 3));
  for (let i = count - 1; i >= 0; i--) {
    let p = point(i);
    if (mode === 1 && previous && i > 0) {
      const sum = [0, 0, 0];
      let n = 0;
      for (
        let neighbor = i - smoothingQuality;
        neighbor <= i + smoothingQuality;
        neighbor++
      ) {
        if (neighbor < 0 || neighbor >= count) continue;
        const value = point(neighbor);
        for (let lane = 0; lane < 3; lane++)
          sum[lane] = f(sum[lane] + value[lane]);
        n++;
      }
      const reciprocal = f(1 / f(n));
      p = sum.map((value) => f(value * reciprocal));
    }
    const tangent = previous
      ? sub(p, previous)
      : i > 0
        ? sub(point(i - 1), p)
        : [0, 0, 0];
    if (previous) distance = f(distance + length(tangent));
    if (f(cutoff) > 0 && distance >= f(cutoff)) continue;
    const magnitude = length(tangent);
    const unit =
      magnitude > f(1e-9)
        ? tangent.map((x) => f(x * f(1 / magnitude)))
        : tangent;
    const width = f(attributes[i * 11 + 5] * f(scales[0] * scales[1]));
    let offset = cross(axis, unit).map((x) => f(x * width));
    if (joinInputs)
      joinInputs.push({
        previousOffset: [...previousOffset],
        currentOffset: [...offset],
        width,
        previousWidth,
        segmentLength: magnitude,
        first: !previous,
      });
    if (mode === 1 && previous)
      offset = correctDirectTrailMode1(
        previousOffset,
        offset,
        width,
        previousWidth,
        magnitude,
      );
    const longitudinal =
      tiling[i * 2] > 0
        ? f((smoothingMode ? odometer[i] : distance) / tiling[i * 2])
        : 0;
    const ratio =
      tiling[i * 2 + 1] > 0
        ? f(width / tiling[i * 2 + 1])
        : tiling[i * 2 + 1] < 0
          ? -tiling[i * 2 + 1]
          : 1;
    const uv = [0, 1].map((side) => {
      const across = side ? f(0.5 + f(0.5 * ratio)) : f(0.5 - f(0.5 * ratio));
      return [0, 1].map((lane) =>
        f(
          f(
            f(
              longitudinal *
                (uvTransform?.[i * 6 + lane] ?? (lane === 0 ? 1 : 0)),
            ) +
              f(
                across *
                  (uvTransform?.[i * 6 + 2 + lane] ?? (lane === 1 ? 1 : 0)),
              ),
          ) + f((uvTransform?.[i * 6 + 4 + lane] ?? 0) + emitterOffset[lane]),
        ),
      );
    });
    let multU = attributes[i * 11 + 8],
      multUOther = multU;
    if (textureAddressMode <= 1) {
      if (used === 0) {
        baseU = f(uv[0][0] - f(uv[0][0] % 2));
        baseMultU = f(multU - f(multU % 2));
      }
      uv[0][0] = f(uv[0][0] - baseU);
      uv[1][0] = f(uv[1][0] - baseU);
      // Original 0x173867b subtracts the base layer's first U offset from
      // the first side of the auxiliary UV, but its own offset on side two.
      multU = f(multU - (used === 0 ? baseMultU : baseU));
      multUOther = f(multUOther - baseMultU);
    }
    const color = Array.from(
      attributes.subarray(i * 11 + 1, i * 11 + 5),
      (x, lane) => f(x * multiplier[lane]),
    );
    if (blendMode === 0) {
      for (let lane = 0; lane < 3; lane++)
        color[lane] = f(color[lane] * color[3]);
      color[3] = 1;
    }
    for (let side = 0; side < 2; side++) {
      const at = (used * 2 + side) * 28;
      for (let lane = 0; lane < 3; lane++)
        out.setFloat32(
          at + lane * 4,
          f(p[lane] + (side ? -offset[lane] : offset[lane])),
          true,
        );
      output.set(directPackedColor(color), at + 12);
      const packedUv = [
        ...uv[side],
        attributes[i * 11],
        attributes[i * 11 + 10],
        side ? multUOther : multU,
        attributes[i * 11 + 9],
      ];
      for (let lane = 0; lane < 6; lane++)
        out.setUint16(
          at + 16 + lane * 2,
          directTrailHalf(packedUv[lane]),
          true,
        );
    }
    if (used) {
      const v = used * 2;
      indices.set([v, v - 2, v - 1, v, v - 1, v + 1], indexCount);
      indexCount += 6;
    }
    used++;
    previous = p;
    previousOffset = offset;
    previousWidth = width;
  }
  return {
    vertices: used === count ? output : output.slice(0, used * 56),
    indices:
      indexCount === indices.length ? indices : indices.slice(0, indexCount),
    ...(joinInputs ? { joinInputs } : {}),
  };
}
