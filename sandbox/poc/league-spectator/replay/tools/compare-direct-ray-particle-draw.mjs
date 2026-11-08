import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { createLatestVfxValues } from "../latest-vfx-values.mjs";
import { createLatestVfxBirth } from "../latest-vfx-birth.mjs";
import { sampleDirectEffectBirth } from "../latest-direct-effect-birth.mjs";
import { directRayRetainedParticle } from "../latest-direct-effect-ray-draw.mjs";
import { compileDirectRayProgram } from "../latest-direct-effect-ray-program.mjs";
import { directRayGeometry } from "../latest-direct-effect-ray.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {},
  f = Math.fround;
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Ray particle input drift:${path}`);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
    JSON.parse(new TextDecoder().decode(await raw(path))),
  bytes = (hex) => Uint8Array.fromHex(hex),
  floats = (hex) => new Float32Array(bytes(hex).buffer);
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(`${cache}/research/direct-ray-linked-uv-native.json`),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  valueBytes = await raw(`${cache}/public/decoder-16.21-macos/vfx-values.json`),
  birthBytes = await raw(`${cache}/public/decoder-16.21-macos/vfx-birth.json`),
  values = createLatestVfxValues(
    JSON.parse(new TextDecoder().decode(valueBytes)),
  ),
  birth = createLatestVfxBirth(
    JSON.parse(new TextDecoder().decode(birthBytes)),
    values,
  ),
  manifest = await read(`${cache}/public/latest-effects/manifest.json`);
assert.equal(native.kind, "original-ray-linked-uv-particle-controls");
assert.equal(native.build, profile.clientVersion);
assert.equal(native.protocol, profile.protocolDigest);
assert.equal(await sha256(image), profile.decoderImageSha256);
assert.equal(await sha256(valueBytes), profile.vfxValuesSha256);
assert.equal(await sha256(birthBytes), profile.vfxBirthSha256);
assert.equal(native.decoderImageSha256, profile.decoderImageSha256);
for (const [path, hash] of Object.entries(native.inputs))
  assert.equal(
    await sha256(await raw(path)),
    hash,
    `Native provenance:${path}`,
  );
assert(native.originalBlocks.length > 0);
for (const block of native.originalBlocks)
  assert.equal(
    await sha256(image.subarray(block.rva, block.rva + block.size)),
    block.sha256,
  );
const expected = new Set();
for (const index of [2, 10])
  for (const seed of ["0000000000000001", "0000000000012345"])
    for (const pose of ["identity", "yaw90", "pitch90"])
      expected.add(`${index}:${seed}:${pose}`);
const mismatches = [],
  counts = {
    cases: 0,
    frames: 0,
    particles: 0,
    births: 0,
    rngChecks: 0,
    positionBytes: 0,
    axisBytes: 0,
    attributeBytes: 0,
    geometryBytes: 0,
    vertexPositionBytes: 0,
    indexBytes: 0,
    positiveAreaTriangles: 0,
  };
const numerical = {
  positionMaxError: 0,
  axisMaxError: 0,
  vertexMaxError: 0,
  nonidenticalFloatLanes: 0,
  tolerance: 0.0001,
};
function compare(actual, expectedBytes, label, counter) {
  const a = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength),
    e = expectedBytes;
  assert.equal(a.length, e.length, label);
  counts[counter] += e.length;
  for (let i = 0; i < e.length; i++)
    if (a[i] !== e[i])
      mismatches.push({ label, byte: i, actual: a[i], expected: e[i] });
}
function compareFloats(actual, expected, label, counter, maximum) {
  assert.equal(actual.length, expected.length, label);
  counts[counter] += actual.byteLength;
  for (let i = 0; i < actual.length; i++) {
    const error = Math.abs(actual[i] - expected[i]);
    numerical[maximum] = Math.max(numerical[maximum], error);
    if (!Object.is(actual[i], expected[i])) numerical.nonidenticalFloatLanes++;
    if (!Number.isFinite(error) || error > numerical.tolerance)
      mismatches.push({
        label,
        lane: i,
        actual: actual[i],
        expected: expected[i],
        error,
      });
  }
}
const identityBasis = [1, 0, 0, 0, 1, 0, 0, 0, 1];
for (const c of native.cases) {
  const key = `${c.emitterIndex}:${c.seedHex}:${c.pose}`;
  assert(expected.delete(key), "Exact unique original Ray cohort required");
  assert.equal(c.frames.length, 61);
  const ref = manifest.definitions[c.effectId],
    sourceBytes = await raw(`${cache}/public/latest-effects/${ref.file}`);
  assert.equal(await sha256(sourceBytes), ref.sha256);
  const source = JSON.parse(new TextDecoder().decode(sourceBytes)).definition
      .complexEmitterDefinitionData[c.emitterIndex],
    program = compileDirectRayProgram(source),
    random = birth.createRandom(BigInt(`0x${c.seedHex}`));
  assert(program);
  assert.equal(source.isLocalOrientation, 0);
  assert.equal(source.bindWeight.constantValue, 1);
  assert.equal(source.birthVelocity, undefined);
  assert.deepEqual(birth.pointOffset(source.SpawnShape), [0, 50, 0]);
  assert.equal(source.birthRotationalVelocity0, undefined);
  assert.equal(source.rotation0, undefined);
  counts.cases++;
  let birthsForCase = 0,
    positiveForCase = 0;
  const retainedBirths = new Map();
  for (const [tick, frame] of c.frames.entries()) {
    assert.equal(frame.input.time, tick / 60);
    counts.frames++;
    const { state, geometry } = frame.output,
      vectors = state.vectors,
      life = floats(vectors.life.hex),
      motion = floats(vectors.motion.hex),
      initial = floats(vectors.initial.hex),
      particle = floats(vectors.particle.hex),
      nativeAttrs = floats(vectors.attributes.hex),
      count = vectors.life.count;
    assert.equal(count, geometry.writerInputs.count);
    for (const newborn of state.births) {
      const actual = sampleDirectEffectBirth(birth, source, 0, random),
        nativeBirth = floats(newborn.birthHex);
      assert.deepEqual(
        [
          actual.life,
          ...actual.color,
          ...actual.scale,
          ...actual.rotation,
          actual.chance,
        ],
        [
          nativeBirth[51],
          ...nativeBirth.slice(16, 20),
          ...nativeBirth.slice(26, 29),
          ...nativeBirth.slice(23, 26),
          nativeBirth[52],
        ],
        "Original sampled birth and retained chance",
      );
      counts.births++;
      retainedBirths.set(birthsForCase, {
        sampled: actual,
        origin: Array.from(nativeBirth.slice(12, 15), (v, lane) =>
          f(v - f(frame.input.current[lane])),
        ),
      });
      birthsForCase++;
    }
    const snap = random.snapshot(),
      rng = bytes(state.rngHex),
      rv = new DataView(rng.buffer);
    // Original actor seeds its stream lazily on first birth. Before that,
    // the isolated observer's untouched stream storage is constructor 1/0.
    assert.equal(
      rv.getBigUint64(0, true).toString(16).padStart(16, "0"),
      birthsForCase ? snap.stateHex : "0000000000000001",
    );
    assert.equal(rv.getUint32(8, true), birthsForCase ? snap.draws : 0);
    counts.rngChecks++;
    const positions = new Float32Array(count * 3),
      axes = new Float32Array(count * 3),
      attrs = new Float32Array(count * 11);
    for (let i = 0; i < count; i++) {
      const age = f(f(frame.input.time) - life[i * 2]),
        fraction = f(age / life[i * 2 + 1]);
      assert.deepEqual(
        Array.from(initial.slice(i * 28 + 3, i * 28 + 6)),
        [0, 50, 0],
      );
      const ordinal = new DataView(bytes(vectors.ordinal.hex).buffer).getUint32(
        i * 4,
        true,
      );
      assert(retainedBirths.has(ordinal));
      const retained = retainedBirths.get(ordinal);
      assert.deepEqual(
        Array.from(initial.slice(i * 28 + 12, i * 28 + 15)),
        retained.sampled.rotation,
      );
      assert.deepEqual(Array.from(motion.slice(i * 9, i * 9 + 7)), [
        ...retained.sampled.color,
        ...retained.sampled.scale,
      ]);
      assert.equal(motion[i * 9 + 8], retained.sampled.chance);
      const out = directRayRetainedParticle({
        birthBasis: identityBasis,
        birthOrigin: retained.origin,
        motion: birth.pointOffset(source.SpawnShape),
        rootPosition: frame.input.current,
        bound: true,
        rotation: retained.sampled.rotation,
        birthScale: retained.sampled.scale,
        sampledScale: values.sample(source.scale0, fraction, [1, 1, 1]),
        birthColor: retained.sampled.color,
        sampledColor: values.sample(source.Color, fraction, [1, 1, 1, 1]),
        fraction,
        chance: retained.sampled.chance,
        rayProgram: program,
      });
      positions.set(out.position, i * 3);
      axes.set(out.axis, i * 3);
      attrs.set(out.attributes, i * 11);
      compareFloats(
        out.position,
        particle.slice(i * 43 + 32, i * 43 + 35),
        `${key}:${tick}:${i}:position`,
        "positionBytes",
        "positionMaxError",
      );
      compareFloats(
        out.axis,
        particle.slice(i * 43 + 28, i * 43 + 31),
        `${key}:${tick}:${i}:axis`,
        "axisBytes",
        "axisMaxError",
      );
      compare(
        out.attributes,
        new Uint8Array(nativeAttrs.slice(i * 11, i * 11 + 11).buffer),
        `${key}:${tick}:${i}:attrs`,
        "attributeBytes",
      );
      counts.particles++;
    }
    const draw = directRayGeometry({
      ...geometry.writerInputs,
      positions,
      axes,
      attributes: attrs,
    });
    const expectedVertices = bytes(geometry.verticesHex),
      av = new DataView(draw.vertices.buffer),
      ev = new DataView(expectedVertices.buffer);
    assert.equal(draw.vertices.length, expectedVertices.length);
    counts.geometryBytes += draw.vertices.length;
    for (let at = 0; at < draw.vertices.length; at += 28) {
      compareFloats(
        new Float32Array(draw.vertices.slice(at, at + 12).buffer),
        new Float32Array(expectedVertices.slice(at, at + 12).buffer),
        `${key}:${tick}:vertex${at / 28}`,
        "vertexPositionBytes",
        "vertexMaxError",
      );
      for (let lane = 12; lane < 28; lane++)
        if (av.getUint8(at + lane) !== ev.getUint8(at + lane))
          mismatches.push({
            label: `${key}:${tick}:vertex-packed`,
            byte: at + lane,
            actual: av.getUint8(at + lane),
            expected: ev.getUint8(at + lane),
          });
    }
    for (let at = 0; at < draw.vertices.length; at += 112) {
      const p = Array.from({ length: 3 }, (_, v) =>
          Array.from({ length: 3 }, (_, lane) =>
            ev.getFloat32(at + v * 28 + lane * 4, true),
          ),
        ),
        a = p[1].map((x, l) => x - p[0][l]),
        b = p[2].map((x, l) => x - p[0][l]),
        cross = [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ],
        square = cross.reduce((sum, x) => sum + x * x, 0);
      if (Number.isFinite(square) && square > 0) {
        positiveForCase++;
        counts.positiveAreaTriangles++;
      }
    }
    compare(
      draw.indices,
      bytes(geometry.indicesHex),
      `${key}:${tick}:indices`,
      "indexBytes",
    );
  }
  assert(
    birthsForCase > 0 && positiveForCase > 0,
    "Every Ray component/seed/pose must produce births and indexed positive-area geometry",
  );
}
assert.equal(expected.size, 0);
assert(counts.births > 0 && counts.particles > 0);
for (const [path, hash] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    hash,
    "Final Ray provenance",
  );
const output = `${cache}/research/direct-ray-particle-draw-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "retained-particle-ray-draw-differential",
      inputs,
      counts,
      numerical,
      mismatches,
      scope: {
        sourceAuthoredUnchanged: true,
        sharedBirthValuesAndRng: true,
        sharedRotationBasisAndValueKernels: true,
        nativeParticleTransformOrAttributesUsedAsInput: false,
        retainedInitialEulerAndBirthColorScaleUsedAsInput: false,
        birthValuesDerivedFromSourceAndSharedRng: true,
        originalEmissionBirthRootAndLifetimeClocksSupplied: true,
        originalEmissionScheduleTranslated: false,
        sourcePointOffsetAndExplicitBinding: true,
        materialAdmission: false,
        gpuSubmitted: false,
        nativeWorldAcceptance: null,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ output, counts, mismatches: mismatches.length }));
if (mismatches.length) process.exitCode = 1;
