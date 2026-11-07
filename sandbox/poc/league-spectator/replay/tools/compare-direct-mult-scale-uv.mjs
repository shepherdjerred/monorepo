// Independent original clock/update/vertex observations, before material or
// compiler admission. Supplied inputs do not establish match-level fidelity.
import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { createLatestVfxValues } from "../latest-vfx-values.mjs";
import {
  compileDirectMultUv,
  sampleDirectMultUvMatrix,
  sampleDirectMultUvCorners,
} from "../latest-direct-effect-mult-uv.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Dynamic MULT input drift: ${path}`);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(
    `${cache}/research/direct-mult-scale-uv-native-v32.json`,
  ),
  values = createLatestVfxValues(
    await read(`${cache}/public/decoder-16.21-macos/vfx-values.json`),
  );
for (const [path, hash] of Object.entries(native.inputs))
  assert.equal(await sha256(await raw(path)), hash, path);
assert.equal(
  native.kind,
  "original-dynamic-multiply-uv-clock-and-typed-schedules",
);
assert.equal(native.leafControls.length, 12);
assert.equal(native.cases.length, 16);
const counts = {
    leafFrames: 0,
    leafMatrixLanes: 0,
    scheduleFrames: 0,
    poolMatrixLanes: 0,
    packedMultHalfLanes: 0,
    texturePresenceStatePairs: 0,
    distinctParticleMatricesFrames: 0,
    delayedBirths: 0,
    tailFrames: 0,
  },
  mismatches = [];
const floats = (v) =>
  new Float32Array(
    Uint8Array.fromHex(typeof v === "string" ? v : v.hex).buffer,
  );
function exact(actual, expected, context) {
  assert.equal(actual.length, expected.length, JSON.stringify(context));
  for (let i = 0; i < actual.length; i++) {
    if (!Object.is(actual[i], expected[i]))
      mismatches.push({
        ...context,
        lane: i,
        actual: actual[i],
        expected: expected[i],
        actualNegativeZero: Object.is(actual[i], -0),
        expectedNegativeZero: Object.is(expected[i], -0),
      });
  }
}
for (const c of native.leafControls) {
  const program = compileDirectMultUv(c.source, "arbitrary-quad");
  assert.ok(program);
  for (const frame of c.frames) {
    exact(
      sampleDirectMultUvMatrix(program, frame.input.normalizedAge, values),
      floats(frame.output.matrices.mult),
      { kind: "leaf", birthAge: c.birthInput.emitterAge, input: frame.input },
    );
    counts.leafFrames++;
    counts.leafMatrixLanes += 6;
  }
}
for (const c of native.cases) {
  const program = compileDirectMultUv(c.source, "arbitrary-quad");
  assert.ok(program);
  const absent = native.cases.find(
    (a) =>
      a.variant === c.variant &&
      a.seedHex === c.seedHex &&
      !a.multTexturePresent,
  );
  for (const [tick, frame] of c.frames.entries()) {
    const life = floats(frame.output.state.vectors.life),
      matrix = floats(frame.output.state.vectors.unknown88),
      count = life.length / 2;
    assert.equal(matrix.length, count * 6);
    const distinct = new Set();
    for (let particle = 0; particle < count; particle++) {
      const age = Math.fround(
          Math.fround(frame.input.time) - life[particle * 2],
        ),
        fraction = Math.fround(age / life[particle * 2 + 1]),
        actual = sampleDirectMultUvMatrix(program, fraction, values);
      exact(actual, matrix.subarray(particle * 6, particle * 6 + 6), {
        kind: "pool",
        variant: c.variant,
        tick,
        particle,
        age,
        fraction,
      });
      counts.poolMatrixLanes += 6;
      distinct.add(Buffer.from(actual.buffer).toString("hex"));
      if (life[particle * 2] > 0) counts.delayedBirths++;
    }
    if (distinct.size > 1) counts.distinctParticleMatricesFrames++;
    if (frame.input.time > 1 && count > 0) counts.tailFrames++;
    if (c.multTexturePresent) {
      assert.deepEqual(frame.output.state, absent.frames[tick].output.state);
      counts.texturePresenceStatePairs++;
      const b = new DataView(
        Uint8Array.fromHex(frame.output.geometry.verticesHex).buffer,
      );
      assert.equal(b.byteLength, count * 112);
      for (let outputParticle = 0; outputParticle < count; outputParticle++) {
        const particle = count - outputParticle - 1,
          age = Math.fround(Math.fround(frame.input.time) - life[particle * 2]),
          fraction = Math.fround(age / life[particle * 2 + 1]),
          corners = sampleDirectMultUvCorners(program, fraction, values);
        for (let corner = 0; corner < 4; corner++)
          for (let lane = 0; lane < 2; lane++) {
            const expected = b.getUint16(
                (outputParticle * 4 + corner) * 28 + 24 + lane * 2,
                true,
              ),
              actual = corners[corner * 2 + lane];
            if (actual !== expected)
              mismatches.push({
                kind: "packed",
                variant: c.variant,
                tick,
                outputParticle,
                corner,
                lane,
                actual,
                expected,
              });
            counts.packedMultHalfLanes++;
          }
      }
    }
    counts.scheduleFrames++;
  }
}
assert.ok(
  counts.distinctParticleMatricesFrames > 0,
  "Overlapping particles must require distinct UV matrices",
);
assert.ok(counts.delayedBirths > 0);
assert.ok(counts.tailFrames > 0);
for (const [path, hash] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    hash,
    `Final drift ${path}`,
  );
const output = `${cache}/research/direct-mult-scale-uv-comparison-v32.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-dynamic-multiply-uv-clock-comparison",
      inputs,
      counts,
      mismatches,
      clock: "normalized-particle-age",
      scope: {
        completeTypedSchedulesAndExplicitVariants: true,
        independentClockLeafControls: true,
        exactFloat32MatricesAndPackedHalfLanes: true,
        materialAdmission: false,
        browserAcceptance: false,
        nativeMatchAcceptance: null,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    counts,
    mismatches: mismatches.length,
    first: mismatches.slice(0, 4),
  }),
);
if (mismatches.length) process.exitCode = 1;
