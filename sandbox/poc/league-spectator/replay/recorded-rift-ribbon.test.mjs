import assert from "node:assert/strict";
import test from "node:test";
import { makeRibbonSampler } from "./recorded-rift-ribbon.mjs";

const tickSeconds = 1 / 120;
const program = {
  end: 8 * tickSeconds,
  lifetime: 5,
  particleLifetime: 0.36,
  birthColor: [67 / 255, 70 / 255, 134 / 255, 133 / 255],
  birthScale0: [150, 100, 0],
  offset: [0, -60, 25],
  trailCutoff: 2000,
  trailMode: 2,
  trailSmoothing: 1,
  trailTiling: [2500, 0, 0],
};
const frames = Array.from({ length: 9 }, (_, tick) => ({
  age: tick * tickSeconds,
  position: [15_000 - tick, 0, 0],
  velocity: [-120, 0, 0],
}));

test("packs alternating trail births, winding, and native material channels", () => {
  const sample = makeRibbonSampler(frames, program);
  assert.deepEqual(sample(tickSeconds), {
    count: 1,
    vertices: null,
    indices: null,
  });
  const { count, vertices, indices } = sample(2 * tickSeconds);
  assert.equal(count, 2);
  assert.ok(vertices instanceof Uint8Array && indices instanceof Uint8Array);
  assert.deepEqual(Array.from(indices), [2, 0, 0, 0, 1, 0, 2, 0, 1, 0, 3, 0]);
  const view = new DataView(vertices.buffer);
  assert.deepEqual(
    [0, 28, 56, 84].map((offset) =>
      [0, 4, 8].map((lane) => view.getFloat32(offset + lane, true)),
    ),
    [
      [15060, 25, -150],
      [15060, 25, 150],
      [15058, 25, -150],
      [15058, 25, 150],
    ],
  );
  assert.deepEqual(
    [0, 28, 56, 84].map((offset) =>
      Array.from(vertices.subarray(offset + 12, offset + 16)),
    ),
    [
      [134, 70, 67, 0],
      [134, 70, 67, 0],
      [134, 70, 67, 2],
      [134, 70, 67, 2],
    ],
  );
  assert.equal(view.getUint16(18, true), 0);
  assert.equal(view.getUint16(46, true), 0x3c00);
  assert.equal(view.getUint16(80, true), 0xc600);
  assert.equal(view.getUint16(108, true), 0);
});

test("rejects discontinuity and clears geometry outside the admitted prefix", () => {
  const sample = makeRibbonSampler(frames, {
    ...program,
    particleLifetime: 0.02,
  });
  assert.equal(sample(2 * tickSeconds).count, 2);
  assert.deepEqual(sample(3 * tickSeconds), {
    count: 1,
    vertices: null,
    indices: null,
  });
  assert.deepEqual(sample(program.end + tickSeconds), {
    count: 0,
    vertices: null,
    indices: null,
  });
  assert.throws(
    () =>
      makeRibbonSampler(
        frames.map((frame, i) =>
          i === 4 ? { ...frame, discontinuity: true } : frame,
        ),
        program,
      ),
    /Discontinuous trail input/,
  );
  assert.throws(
    () =>
      makeRibbonSampler(
        frames.filter((_, i) => i !== 4),
        program,
      ),
    /cadence|Discontinuous trail input/,
  );
});
