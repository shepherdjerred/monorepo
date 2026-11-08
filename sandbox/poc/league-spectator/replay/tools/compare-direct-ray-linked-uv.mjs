import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { directRayGeometry } from "../latest-direct-effect-ray.mjs";
import { directRayLinkedGeometry } from "../latest-direct-effect-ray-linked-uv.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Input drift: ${path}`);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
    JSON.parse(new TextDecoder().decode(await raw(path))),
  floats = (hex) => new Float32Array(Uint8Array.fromHex(hex).buffer);
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(`${cache}/research/direct-ray-linked-uv-native.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
assert.equal(native.kind, "original-ray-linked-uv-particle-controls");
assert.equal(native.build, "16.21.829.8620");
assert.equal(native.protocol, "20e09df23c66b85e");
assert.equal(native.decoderImageSha256, await sha256(image));
for (const [path, hash] of Object.entries(native.inputs))
  assert.equal(await sha256(await raw(path)), hash);
for (const b of native.originalBlocks)
  assert.equal(await sha256(image.subarray(b.rva, b.rva + b.size)), b.sha256);
assert.deepEqual(
  native.classification.map((r) => [r.emitterIndex, r.flags]),
  [
    [2, [0, 0]],
    [10, [0, 0]],
  ],
);
assert.equal(native.cases.length, 12);
assert.equal(native.suppliedLinkedUvLeaves.length, 8);
const seen = new Set(),
  examples = [],
  atlasFrames = new Set(),
  paletteAges = new Set();
let frames = 0,
  vertices = 0,
  linkedVertices = 0,
  maxPositionError = 0,
  colorDifferences = 0,
  uvDifferences = 0,
  indexDifferences = 0,
  positiveAreaFrames = 0,
  retainedParticles = 0;
function compare(snapshot, draw, label) {
  const count = draw.writerInputs.count,
    p = floats(snapshot.vectors.particle.hex),
    positions = new Float32Array(count * 3),
    axes = new Float32Array(count * 3);
  assert.equal(snapshot.vectors.particle.count, count);
  assert.equal(snapshot.vectors.attributes.count, count);
  assert.equal(p.length, count * 43);
  for (let i = 0; i < count; i++) {
    positions.set(p.subarray(i * 43 + 32, i * 43 + 35), i * 3);
    axes.set(p.subarray(i * 43 + 28, i * 43 + 31), i * 3);
  }
  const { baseUvMatricesHex, ...writer } = draw.writerInputs,
    attributes = floats(snapshot.vectors.attributes.hex),
    args = {
      ...writer,
      positions,
      axes,
      attributes,
      ...(writer.baseUvPresent
        ? { baseUvMatrices: floats(baseUvMatricesHex) }
        : {}),
    },
    before = structuredClone(args),
    actual = writer.baseUvPresent
      ? directRayLinkedGeometry(args)
      : directRayGeometry(args),
    expected = Uint8Array.fromHex(draw.verticesHex),
    e = new DataView(expected.buffer),
    a = new DataView(actual.vertices.buffer);
  assert.deepEqual(args, before);
  assert.equal(actual.vertices.length, expected.length);
  const expectedIndices = Uint8Array.fromHex(draw.indicesHex),
    actualIndices = new Uint8Array(actual.indices.buffer);
  assert.equal(actualIndices.length, expectedIndices.length);
  for (let i = 0; i < expectedIndices.length; i++)
    indexDifferences += Number(expectedIndices[i] !== actualIndices[i]);
  let localError = 0,
    localColors = 0,
    localUv = 0;
  for (let at = 0; at < expected.length; at += 28) {
    for (let lane = 0; lane < 3; lane++)
      localError = Math.max(
        localError,
        Math.abs(
          a.getFloat32(at + lane * 4, true) - e.getFloat32(at + lane * 4, true),
        ),
      );
    for (let lane = 12; lane < 16; lane++)
      localColors += Number(actual.vertices[at + lane] !== expected[at + lane]);
    for (let lane = 16; lane < 28; lane += 2)
      localUv += Number(
        a.getUint16(at + lane, true) !== e.getUint16(at + lane, true),
      );
  }
  for (let i = 0; i < count; i++) {
    atlasFrames.add(attributes[i * 11]);
    paletteAges.add(attributes[i * 11 + 8]);
  }
  for (let i = 0; i < count; i++) {
    const k = i * 112,
      v = Array.from({ length: 3 }, (_, j) =>
        Array.from({ length: 3 }, (_, l) =>
          e.getFloat32(k + j * 28 + l * 4, true),
        ),
      ),
      ab = v[1].map((x, l) => x - v[0][l]),
      ac = v[2].map((x, l) => x - v[0][l]),
      cross = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
    if (cross.some((x) => x !== 0)) {
      positiveAreaFrames++;
      break;
    }
  }
  if ((localError || localColors || localUv) && examples.length < 8)
    examples.push({ label, localError, localColors, localUv });
  maxPositionError = Math.max(maxPositionError, localError);
  colorDifferences += localColors;
  uvDifferences += localUv;
  frames++;
  vertices += count * 4;
  retainedParticles += count;
  if (writer.baseUvPresent) linkedVertices += count * 4;
}
for (const c of native.cases) {
  const key = `${c.emitterIndex}:${c.seedHex}:${c.pose}`;
  assert([2, 10].includes(c.emitterIndex));
  assert(["0000000000000001", "0000000000012345"].includes(c.seedHex));
  assert(["identity", "yaw90", "pitch90"].includes(c.pose));
  assert(!seen.has(key));
  seen.add(key);
  assert.equal(c.frames.length, 61);
  for (const [tick, frame] of c.frames.entries()) {
    assert.equal(frame.input.time, tick / 60);
    assert.equal(frame.output.geometry.writerInputs.baseUvPresent, false);
    compare(frame.output.state, frame.output.geometry, `${key}:${tick}`);
  }
}
for (const [i, c] of native.suppliedLinkedUvLeaves.entries()) {
  assert.equal(c.geometry.writerInputs.baseUvPresent, true);
  compare(c.state, c.geometry, `supplied-linked-uv:${i}`);
}
assert.equal(seen.size, 12);
assert(positiveAreaFrames > 0);
assert(atlasFrames.size > 4);
assert(paletteAges.size > 4);
assert(linkedVertices > 0);
for (const [path, hash] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), hash);
const output = `${cache}/research/direct-ray-linked-uv-comparison.json`,
  result = {
    schema: 1,
    kind: "original-ray-linked-uv-geometry-comparison",
    frames,
    authoredFrames: 732,
    suppliedLinkedUvLeaves: 8,
    vertices,
    linkedVertices,
    retainedParticles,
    positiveAreaFrames,
    distinctAtlasInputs: atlasFrames.size,
    distinctPaletteAgeInputs: paletteAges.size,
    maxPositionError,
    colorDifferences,
    uvDifferences,
    indexDifferences,
    examples,
    inputs,
    scope: {
      unchangedAuthoredParticleInputs: true,
      originalAtlasAndParticleProducer: true,
      authoredLinkedUvFlags: [0, 0],
      suppliedLinkedUvLeavesAreSeparate: true,
      particleTransformsAreOriginalInputs: true,
      particleTransformTranslationProven: false,
      materialBinding: false,
      paletteTextureBound: false,
      compilerAdmission: false,
      runtimeActivation: false,
      gpuCoverage: false,
      browserPlayback: false,
    },
  };
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, inputs: Object.keys(inputs).length }));
if (maxPositionError || colorDifferences || uvDifferences || indexDifferences)
  throw Error("Original Ray linked UV geometry differs");
