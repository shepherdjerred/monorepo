const vertexBytes = 28;
const indicesPerSegment = 6;
const clockTolerance = 1e-8;

/** @typedef {[number, number, number]} Vector */
/** @typedef {{age: number, position: Vector, velocity: Vector, discontinuity?: boolean}} FlightFrame */
/** @typedef {{age: number, center: Vector, distance: number}} TrailPoint */

const finiteVector = (value) =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const difference = (left, right) =>
  left.map((coordinate, lane) => coordinate - right[lane]);
const length = (vector) => Math.hypot(...vector);

/** Write binary16 in little-endian order using baseline DataView methods. */
function writeHalf(view, offset, value) {
  const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0;
  const magnitude = Math.abs(value);
  const exponent = Math.floor(Math.log2(magnitude));
  const quantum = 2 ** Math.max(-24, exponent - 10);
  const units = magnitude / quantum;
  const lower = Math.floor(units);
  const fraction = units - lower;
  const rounded =
    lower + Number(fraction > 0.5 || (fraction === 0.5 && lower % 2 === 1));
  const bits =
    exponent < -14 ? rounded : (exponent + 15) * 1024 + rounded - 1024;
  view.setUint16(offset, sign | bits, true);
}

/** @returns {Vector} */
function emitterCenter(position, velocity, [side, forward, up]) {
  const speed = length(velocity);
  const [x, y, z] = velocity.map((component) => component / speed);
  const horizontal = Math.hypot(x, z);
  if (!Number.isFinite(horizontal) || horizontal === 0)
    throw new Error("Missing horizontal trail orientation.");
  return [
    Math.fround(
      position[0] -
        (side * z) / horizontal +
        forward * x -
        (up * x * y) / horizontal,
    ),
    Math.fround(position[1] + forward * y + up * horizontal),
    Math.fround(
      position[2] +
        (side * x) / horizontal +
        forward * z -
        (up * z * y) / horizontal,
    ),
  ];
}

function widthDirection(points, index) {
  const previous = points[Math.max(0, index - 1)];
  const next = points[Math.min(points.length - 1, index + 1)];
  const [dx, , dz] = difference(next.center, previous.center);
  const horizontal = Math.hypot(dx, dz);
  if (horizontal === 0) throw new Error("Degenerate trail direction.");
  return [-dz / horizontal, 0, dx / horizontal];
}

function packVertex(view, offset, { position, rgb, alpha, u, side, age }) {
  for (let lane = 0; lane < 3; lane++) {
    view.setFloat32(offset + 4 * lane, position[lane], true);
    view.setUint8(offset + 12 + lane, rgb[lane]);
  }
  view.setUint8(offset + 15, alpha);
  writeHalf(view, offset + 16, u);
  writeHalf(view, offset + 18, side);
  writeHalf(view, offset + 24, age);
  writeHalf(view, offset + 26, 1);
}

function packRibbon(
  points,
  age,
  { lifetime, particleLifetime, rgb, birthAlpha, halfWidth, tileLength },
) {
  const count = points.length;
  const vertices = new DataView(new ArrayBuffer(count * vertexBytes * 2));
  const indices = new DataView(
    new ArrayBuffer((count - 1) * indicesPerSegment * 2),
  );
  // Keep the coordinate within the first point's two-tile window. The
  // leading vertex pair carries an unshifted age on both edges.
  const tileOffset = 2 * Math.floor(points[0].distance / (2 * tileLength));
  for (const [index, point] of points.entries()) {
    const direction = widthDirection(points, index);
    const pointAge = (age - point.age) / particleLifetime;
    const emitterAge = point.age / lifetime;
    const birthFade = Math.min(emitterAge / 0.15, 1, (1 - emitterAge) / 0.1);
    const pointFade = Math.min(1, (1 - pointAge) / 0.3);
    const alpha = Math.floor(255 * birthAlpha * birthFade * pointFade);
    const u = point.distance / tileLength - tileOffset;
    for (let side = 0; side < 2; side++) {
      const edge = side === 0 ? halfWidth : -halfWidth;
      packVertex(vertices, (index * 2 + side) * vertexBytes, {
        position: point.center.map(
          (value, lane) => value + edge * direction[lane],
        ),
        rgb,
        alpha,
        u,
        side,
        age: pointAge - (index > 0 && side === 0 ? tileOffset : 0),
      });
    }
    if (index === 0) continue;
    const first = 2 * index;
    const segment = [first, first - 2, first - 1, first, first - 1, first + 1];
    for (const [lane, value] of segment.entries())
      indices.setUint16(
        ((index - 1) * indicesPerSegment + lane) * 2,
        value,
        true,
      );
  }
  return {
    count,
    vertices: new Uint8Array(vertices.buffer),
    indices: new Uint8Array(indices.buffer),
  };
}

/**
 * Pack geometry for the reviewed Rift trail program from a contiguous flight
 * prefix. The native offline proof subdivides each prefix uniformly at up to
 * 120 Hz and emits on alternating ticks. This sampler uses that cadence.
 *
 * @param {FlightFrame[]} frames
 * @param {{end: number, lifetime: number, particleLifetime: number,
 *   birthColor: number[], birthScale0: number[], offset: Vector,
 *   trailCutoff: number, trailMode: number, trailSmoothing: number,
 *   trailTiling: number[]}} program
 */
export function makeRibbonSampler(frames, program) {
  const {
    end,
    lifetime,
    particleLifetime,
    birthColor,
    birthScale0,
    offset,
    trailCutoff,
    trailMode,
    trailSmoothing,
    trailTiling,
  } = program;
  const [halfWidth] = birthScale0;
  const [tileLength] = trailTiling;
  if (
    trailMode !== 2 ||
    trailSmoothing !== 1 ||
    ![lifetime, particleLifetime, trailCutoff, halfWidth, tileLength].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    !finiteVector(offset) ||
    birthColor.length !== 4 ||
    !birthColor.every((value) => value >= 0 && value <= 1)
  )
    throw new Error("Unsupported native trail configuration.");
  if (
    !Number.isFinite(end) ||
    end <= 0 ||
    frames.length < 2 ||
    frames[0].age !== 0
  )
    throw new Error("Missing contiguous trail prefix.");
  const step = end / (frames.length - 1);
  if (step > 1 / 120 + clockTolerance)
    throw new Error("Unverified trail cadence.");
  /** @type {TrailPoint[]} */
  const points = [];
  let previous;
  let distance = length(frames[0].position);
  for (const [tick, frame] of frames.entries()) {
    const { age, position, velocity } = frame;
    if (
      !Number.isFinite(age) ||
      Math.abs(age - step * tick) > clockTolerance ||
      !finiteVector(position) ||
      !finiteVector(velocity) ||
      frame.discontinuity ||
      (previous && length(difference(position, previous)) > trailCutoff)
    )
      throw new Error("Discontinuous trail input.");
    previous = position;
    if (tick % 2 !== 0 || age > lifetime || length(velocity) === 0) continue;
    const center = emitterCenter(position, velocity, offset);
    const prior = points.at(-1);
    if (prior) distance += length(difference(center, prior.center));
    points.push({ age, center, distance });
  }
  const rgb = [birthColor[2], birthColor[1], birthColor[0]].map((channel) =>
    Math.round(channel * 255),
  );
  const style = {
    lifetime,
    particleLifetime,
    rgb,
    birthAlpha: birthColor[3],
    halfWidth,
    tileLength,
  };
  return (age) => {
    if (!Number.isFinite(age) || age < 0 || age > end)
      return { count: 0, vertices: null, indices: null };
    const visible = points.filter(
      (point) => point.age <= age && age - point.age < particleLifetime,
    );
    if (visible.length < 2)
      return { count: visible.length, vertices: null, indices: null };
    return packRibbon(visible, age, style);
  };
}
