import { resolve } from "node:path";
import { directRayGeometry } from "../latest-direct-effect-ray.mjs";
import {
  directParticleBasis,
  directParticleWorldVector,
} from "../latest-direct-effect-math.mjs";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const value = await Bun.file(path).bytes(),
    hash = await sha256(value);
  if (inputs[path] && inputs[path] !== hash) throw Error("Ray input changed");
  inputs[path] = hash;
  return value;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(`${cache}/research/ray-parent-frames-native.json`);
const original = await read(
  `${cache}/research/direct-ray-geometry-native.json`,
);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
assert.equal(original.kind, "native-direct-ray-default-geometry");
assert.equal(original.build, "16.21.829.8620");
assert.equal(original.protocol, "20e09df23c66b85e");
assert.equal(await sha256(image), original.decoderImageSha256);
assert.equal(native.decoderImageSha256, original.decoderImageSha256);
assert.equal(original.cases.length, 6);
assert.equal(original.controls.length, 24);
assert(original.originalBlocks.length > 0);
for (const [path, hash] of Object.entries(original.inputs))
  assert.equal(await sha256(await raw(path)), hash);
for (const block of original.originalBlocks)
  assert.equal(
    await sha256(image.subarray(block.rva, block.rva + block.size)),
    block.sha256,
  );
const floats = (hex) => new Float32Array(Uint8Array.fromHex(hex).buffer);
const adapt = (state, geometry) => ({
  state: {
    actors: [
      {
        emitterIndex: 5,
        vectors: Object.fromEntries(
          Object.entries(state.vectors).map(([key, v]) => [
            key,
            { ...v, bytesHex: v.hex },
          ]),
        ),
      },
    ],
  },
  geometry: [
    {
      ...geometry,
      emitterIndex: 5,
      kind: "ray",
      particleCount: geometry.writerInputs.count,
    },
  ],
});
const seen = new Set();
let basisChecks = 0;
for (const c of original.cases) {
  const key = `${c.seedHex}:${c.pose}`;
  assert(!seen.has(key));
  seen.add(key);
  assert(["identity", "yaw90", "pitch90"].includes(c.pose));
  assert(["0000000000000001", "0000000000012345"].includes(c.seedHex));
  assert.equal(c.frames.length, 31);
  for (const [tick, frame] of c.frames.entries()) {
    assert.equal(frame.input.time, tick / 60);
    const state = frame.output.state;
    if (state.vectors.life.count) {
      const particles = floats(state.vectors.particle.hex),
        basis = frame.input.basis.filter((_, i) => i < 12 && i % 4 !== 3);
      assert.deepEqual(
        Array.from(particles.subarray(28, 31)),
        directParticleWorldVector(directParticleBasis([-90, 0, 0])[2], basis),
      );
      basisChecks++;
    }
  }
  native.cases.push({
    ...c,
    frames: c.frames.map((f) => adapt(f.output.state, f.output.geometry)),
  });
}
const controlKeys = new Set();
const expectedControls = new Set();
for (const blend of [0, 1, 4])
  for (const axis of [
    [0, 1, 0],
    [1, 2, 3],
    [0, 0, 0],
    [Math.fround(1e-6), 0, 0],
  ])
    for (const color of [
      [0.3, 0.6, 0.9, 0.4],
      [-1, 2, 0.5, 1.5],
    ])
      expectedControls.add(
        JSON.stringify([blend, axis, color.map(Math.fround)]),
      );
for (const c of original.controls) {
  const particle = floats(c.state.vectors.particle.hex),
    attrs = floats(c.state.vectors.attributes.hex);
  const key = JSON.stringify([
    c.geometry.writerInputs.blendMode,
    Array.from(particle.subarray(28, 31)),
    Array.from(attrs.subarray(1, 5)),
  ]);
  assert(!controlKeys.has(key));
  controlKeys.add(key);
  assert(
    expectedControls.delete(key),
    "Exact blend/axis/HDR control matrix required",
  );
}
assert.equal(expectedControls.size, 0);
native.cases.push({
  effectId: "supplied-native-writer-controls",
  frames: original.controls.map((c) => adapt(c.state, c.geometry)),
});
let frames = 0,
  vertices = 0,
  colorDifferences = 0,
  uvDifferences = 0,
  maxError = 0;
const examples = [];
for (const c of native.cases)
  for (const frame of c.frames)
    for (const draw of frame.geometry) {
      if (draw.kind !== "ray" || (!draw.particleCount && !draw.writerInputs))
        continue;
      const actor = frame.state.actors.find(
          (a) => a.emitterIndex === draw.emitterIndex,
        ),
        count = draw.particleCount;
      if (actor.vectors.unknown78.count || actor.vectors.unknown88.count)
        continue;
      const particle = floats(actor.vectors.particle.bytesHex),
        positions = new Float32Array(count * 3),
        axes = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        positions.set(particle.subarray(i * 43 + 32, i * 43 + 35), i * 3);
        axes.set(particle.subarray(i * 43 + 28, i * 43 + 31), i * 3);
      }
      const parent = frame.state.parentHex
          ? floats(frame.state.parentHex)
          : null,
        attrs = floats(actor.vectors.attributes.bytesHex);
      const writerInputs = draw.writerInputs ?? {
        count,
        viewPosition: native.camera.position,
        systemScale: Array.from(parent.subarray(0x150 / 4, 0x158 / 4)),
        colorMultiplier: Array.from(parent.subarray(0x1b8 / 4, 0x1c8 / 4)),
        blendMode: 1,
        projectionScroll: 0,
        uvScale: [1, 1],
        emitterUv: [0, 0],
        baseUvPresent: false,
        multUvPresent: false,
        multTexturePresent: false,
      };
      const args = { ...writerInputs, positions, axes, attributes: attrs },
        before = JSON.stringify(args);
      const actual = directRayGeometry(args);
      assert.equal(
        JSON.stringify(args),
        before,
        "Pure draw must not mutate retained inputs",
      );
      assert.equal(
        new Uint8Array(actual.indices.buffer).toHex(),
        draw.indicesHex,
      );
      const expected = Uint8Array.fromHex(draw.verticesHex),
        a = new DataView(actual.vertices.buffer),
        e = new DataView(expected.buffer);
      assert.equal(actual.vertices.length, expected.length);
      let localError = 0,
        localColor = 0,
        localUv = 0;
      for (let at = 0; at < expected.length; at += 28) {
        for (let lane = 0; lane < 3; lane++)
          localError = Math.max(
            localError,
            Math.abs(
              a.getFloat32(at + lane * 4, true) -
                e.getFloat32(at + lane * 4, true),
            ),
          );
        for (let lane = 12; lane < 16; lane++)
          if (actual.vertices[at + lane] !== expected[at + lane]) localColor++;
        for (let lane = 16; lane < 28; lane += 2)
          if (a.getUint16(at + lane, true) !== e.getUint16(at + lane, true))
            localUv++;
      }
      maxError = Math.max(maxError, localError);
      colorDifferences += localColor;
      uvDifferences += localUv;
      if ((localError !== 0 || localColor || localUv) && examples.length < 8)
        examples.push({
          id: c.effectId,
          emitter: draw.emitterIndex,
          time: frame.time,
          localError,
          localColor,
          localUv,
        });
      frames++;
      vertices += expected.length / 28;
    }
assert(basisChecks > 0);
for (const [path, hash] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), hash);
const output = `${cache}/research/direct-ray-geometry-comparison.json`;
const result = {
  schema: 1,
  kind: "direct-js-ray-default-geometry-comparison",
  inputs,
  frames,
  vertices,
  maxError,
  colorDifferences,
  uvDifferences,
  examples,
  basisChecks,
  originalTypedCases: 6,
  originalTypedFrames: 186,
  originalWriterControls: 24,
  scope: {
    retainedAxisIsOrientationThirdColumnNotVelocity: true,
    sourceEmitterUnchanged: true,
    legacyWholeParentSubsetIsAdditionalHistoricalOracle: true,
    defaultUnboundUvOnly: true,
    nonzeroProjectionScrollImplemented: false,
    runtimeAdmissionChanged: false,
    materialsImplemented: false,
    matchCoverage: false,
    browserPlayback: false,
  },
};
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({ ...result, inputs: Object.keys(inputs).length }, null, 2),
);
if (maxError || colorDifferences || uvDifferences)
  throw Error("Original ray geometry differs");
