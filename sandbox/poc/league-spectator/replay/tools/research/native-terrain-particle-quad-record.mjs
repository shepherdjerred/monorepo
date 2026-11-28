import { directTrailHalf } from "../../latest-direct-effect-trail.mjs";

export const particleQuadRecordDwords = 40;

function requireFloatLanes(values, count, name) {
  if (
    !Array.isArray(values) ||
    values.length !== count ||
    Array.from(values).some(
      (value) =>
        typeof value !== "number" || !Number.isFinite(Math.fround(value)),
    )
  )
    throw new TypeError(`Expected ${count} finite float32 lanes for ${name}`);
}

/**
 * Pack the .8428 QUAD_VS.vs instance record for facing data and UV parallax
 * both zero. This is the observed shader input layout, with no native
 * emitter or placement inference.
 */
export function encodeParticleQuadRecord({
  xAxis,
  yAxis,
  zAxis,
  position,
  baseUv,
  lookupUv,
  color,
  frame,
}) {
  requireFloatLanes(xAxis, 3, "xAxis");
  requireFloatLanes(yAxis, 3, "yAxis");
  requireFloatLanes(zAxis, 3, "zAxis");
  requireFloatLanes(position, 3, "position");
  requireFloatLanes(baseUv, 6, "baseUv");
  requireFloatLanes(lookupUv, 6, "lookupUv");
  requireFloatLanes(color, 4, "color");
  if (!Number.isInteger(frame) || frame < 0 || frame > 2048)
    throw new RangeError("Expected an exact nonnegative binary16 atlas frame");

  const bits = new Uint32Array(particleQuadRecordDwords);
  const floats = new Float32Array(bits.buffer);
  floats.set(xAxis, 0);
  floats.set(yAxis, 4);
  floats.set(zAxis, 8);
  floats[3] = position[0];
  floats[7] = position[1];
  floats[11] = position[2];

  // Each UV row is [localU, localV, constant], followed by one color lane.
  floats.set(baseUv.slice(0, 3), 12);
  floats.set(baseUv.slice(3), 16);
  floats.set(lookupUv.slice(0, 3), 20);
  floats.set(lookupUv.slice(3), 24);
  floats[15] = color[0];
  floats[19] = color[1];
  floats[23] = color[2];
  floats[27] = color[3];
  bits[31] = directTrailHalf(frame) << 16;
  // Quaternion and alternate-facing data are unused in this branch.
  return bits;
}
