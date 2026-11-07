import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { LatestDirectEffectRuntime } from "../latest-direct-effect-runtime.mjs";
import { directGeometryBuffers } from "../latest-direct-effect-draw.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {},
  f = Math.fround;
async function raw(path) {
  path = resolve(path);
  const data = await Bun.file(path).bytes(),
    hash = await sha256(data);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Ray schedule input drift:${path}`);
  inputs[path] = hash;
  return data;
}
const read = async (path) =>
    JSON.parse(new TextDecoder().decode(await raw(path))),
  load = (path) => raw(`${cache}/public/${path}`),
  floats = (hex) => new Float32Array(Uint8Array.fromHex(hex).buffer);
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(`${cache}/research/direct-ray-linked-uv-native.json`),
  particleProof = await read(
    `${cache}/research/direct-ray-particle-draw-comparison.json`,
  ),
  manifestBytes = await load("latest-effects/manifest.json"),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await load("decoder-16.21-macos/image.bin");
assert.equal(await sha256(image), profile.decoderImageSha256);
assert.equal(native.decoderImageSha256, profile.decoderImageSha256);
assert.equal(native.build, profile.clientVersion);
assert.equal(native.protocol, profile.protocolDigest);
assert.equal(native.kind, "original-ray-linked-uv-particle-controls");
assert.equal(particleProof.kind, "retained-particle-ray-draw-differential");
assert.equal(particleProof.counts.frames, 732);
assert.equal(particleProof.mismatches.length, 0);
for (const evidence of [native, particleProof])
  for (const [path, hash] of Object.entries(evidence.inputs))
    assert.equal(
      await sha256(await raw(path)),
      hash,
      `Ray prerequisite:${path}`,
    );
for (const b of native.originalBlocks)
  assert.equal(await sha256(image.subarray(b.rva, b.rva + b.size)), b.sha256);
const ids = [...new Set(native.cases.map((c) => c.effectId))],
  prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes,
    effectIds: ids,
  });
const expected = new Set();
for (const index of [2, 10])
  for (const seed of ["0000000000000001", "0000000000012345"])
    for (const pose of ["identity", "yaw90", "pitch90"])
      expected.add(`${index}:${seed}:${pose}`);
const mismatches = [],
  comparisons = [],
  counts = {
    cases: 0,
    frames: 0,
    particles: 0,
    vertices: 0,
    colors: 0,
    halfWords: 0,
    indices: 0,
    streams: 0,
    poolLanes: 0,
    pauseChecks: 0,
    seekChecks: 0,
    clockChecks: 0,
    actualCompiledForgeryRejections: 0,
  },
  numerical = { maxPositionError: 0, maxPoolError: 0, tolerance: 0.0001 };
function difference(actual, expected, context, kind) {
  const error = Math.abs(actual - expected);
  if (kind === "position")
    numerical.maxPositionError = Math.max(numerical.maxPositionError, error);
  else numerical.maxPoolError = Math.max(numerical.maxPoolError, error);
  if (!Number.isFinite(error) || error > numerical.tolerance)
    mismatches.push({ ...context, kind, actual, expected, error });
}
for (const c of native.cases) {
  const key = `${c.emitterIndex}:${c.seedHex}:${c.pose}`;
  assert(expected.delete(key));
  assert.equal(c.frames.length, 61);
  const definition = prepared.definitions.get(c.effectId),
    program = definition.emitters.find((e) => e.index === c.emitterIndex);
  assert.equal(
    definition.blockers.length,
    0,
    "Fixture root must pass actual shared compiler",
  );
  assert.equal(
    program?.primitive,
    "ray",
    "Actual installed Ray source/material must be admitted",
  );
  assert.equal(
    program.rayMaterialSelection?.status,
    "owned-direct-ray-material-selection",
  );
  // Isolate one real compiled emitter for a numeric component control. Original
  // unsupported siblings remain identifiable and never count as completed.
  const isolated = { ...definition, emitters: [program] },
    basis = c.frames[0].input.basis.filter((_, i) => i < 12 && i % 4 !== 3),
    create = (controlDefinition = isolated) =>
      new LatestDirectEffectRuntime({
        ...prepared.contract,
        replayHash: "6".repeat(64),
        definitions: new Map([[definition.id, controlDefinition]]),
        kernels: prepared.kernels,
        events: [
          {
            id: `ray-control:${key}`,
            kind: "create",
            origin: "animation",
            entityId: 1,
            definitionId: definition.id,
            time: 0,
            transportSequence: 0,
            entryOrder: 0,
            seedHex: c.seedHex,
          },
        ],
        world: {
          placement: (_e, time) => ({
            resolved: true,
            position: [23 + time * 130, -11 + time * 3, 81 + time * 70],
            basis,
          }),
        },
        checkpointSeconds: 0.125,
        maximumCheckpoints: 32,
      }),
    runtime = create(),
    fast = create(),
    camera = (time) => ({
      right: [1, 0, 0],
      up: [0, 1, 0],
      position: [300 + time * 30, 900, 1200],
    });
  for (const mutate of [
    (e) => (e.bound = false),
    (e) => (e.inheritSystemBasis = true),
    (e) => (e.offset[1] = 0),
    (e) => (e.emitterPosition = [1, 0, 0]),
    (e) => (e.velocity = [0, 0, 0]),
    (e) => (e.rayProgram.palette.coefficients[0] = 2),
    (e) => (e.rayPaletteTexture.sha256 = "bad"),
  ]) {
    const altered = structuredClone(isolated);
    mutate(altered.emitters[0]);
    assert.throws(
      () => create(altered),
      "Real compiled Ray corruption must fail before simulation",
    );
    counts.actualCompiledForgeryRejections++;
  }
  counts.cases++;
  let visual = null,
    visualScore = -1;
  for (const [tick, frame] of c.frames.entries()) {
    const context = { key, tick };
    runtime.advanceTo(frame.input.time);
    const saved = runtime.checkpoint(),
      packet = runtime.generateDraws(camera(frame.input.time)),
      draw = packet.draws.find((d) => d.emitterId === program.index),
      actual = draw
        ? directGeometryBuffers(draw)
        : { vertices: new Uint8Array(0), indices: new Uint8Array(0) },
      expectedVertices = Uint8Array.fromHex(frame.output.geometry.verticesHex),
      expectedIndices = Uint8Array.fromHex(frame.output.geometry.indicesHex);
    assert.deepEqual(
      runtime.checkpoint(),
      saved,
      "Camera draw must not simulate",
    );
    counts.pauseChecks++;
    if (actual.vertices.length !== expectedVertices.length)
      mismatches.push({
        ...context,
        kind: "vertex-count",
        actual: actual.vertices.length,
        expected: expectedVertices.length,
      });
    if (actual.indices.length !== expectedIndices.length)
      mismatches.push({
        ...context,
        kind: "index-count",
        actual: actual.indices.length,
        expected: expectedIndices.length,
      });
    const a = new DataView(actual.vertices.buffer),
      e = new DataView(expectedVertices.buffer);
    let score = 0;
    if (actual.vertices.length === expectedVertices.length)
      for (let at = 0; at < expectedVertices.length; at += 28) {
        for (let lane = 0; lane < 3; lane++)
          difference(
            a.getFloat32(at + lane * 4, true),
            e.getFloat32(at + lane * 4, true),
            { ...context, vertex: at / 28, lane },
            "position",
          );
        for (let lane = 12; lane < 16; lane++) {
          if (a.getUint8(at + lane) !== e.getUint8(at + lane))
            mismatches.push({ ...context, kind: "color", byte: at + lane });
          counts.colors++;
        }
        for (let lane = 16; lane < 28; lane += 2) {
          if (a.getUint16(at + lane, true) !== e.getUint16(at + lane, true))
            mismatches.push({ ...context, kind: "half-uv", byte: at + lane });
          counts.halfWords++;
        }
        score = Math.max(score, e.getUint8(at + 15));
        counts.vertices++;
      }
    for (
      let i = 0;
      i < Math.min(actual.indices.length, expectedIndices.length);
      i++
    )
      if (actual.indices[i] !== expectedIndices[i])
        mismatches.push({ ...context, kind: "index", byte: i });
    counts.indices += expectedIndices.length / 2;
    const nativeState = frame.output.state,
      n = nativeState.vectors.life.count,
      current = runtime.checkpoint().instances[0]?.[1]?.emitters[0];
    if (n !== current?.count && !(n === 0 && !current))
      mismatches.push({
        ...context,
        kind: "pool-count",
        actual: current?.count ?? 0,
        expected: n,
      });
    if (current) {
      const life = floats(nativeState.vectors.life.hex),
        motion = floats(nativeState.vectors.motion.hex),
        initial = floats(nativeState.vectors.initial.hex);
      for (let i = 0; i < Math.min(n, current.count); i++)
        for (const [lane, value] of [
          [0, life[i * 2]],
          [1, life[i * 2 + 1]],
          ...[0, 1, 2, 3].map((l) => [5 + l, motion[i * 9 + l]]),
          ...[0, 1, 2].map((l) => [9 + l, motion[i * 9 + 4 + l]]),
          ...[0, 1, 2].map((l) => [12 + l, initial[i * 28 + 12 + l]]),
          [18, motion[i * 9 + 8]],
        ]) {
          difference(
            current.data[i * 20 + lane],
            value,
            { ...context, particle: i, lane },
            "retained-pool",
          );
          counts.poolLanes++;
        }
      const rng = new DataView(Uint8Array.fromHex(nativeState.rngHex).buffer),
        draws = rng.getUint32(8, true),
        nativeSeed = draws
          ? rng.getBigUint64(0, true)
          : BigInt(`0x${c.seedHex}`);
      if (
        current.random.draws !== draws ||
        current.random.stateHex !== nativeSeed.toString(16).padStart(16, "0")
      )
        mismatches.push({ ...context, kind: "rng-state" });
      counts.streams++;
    }
    counts.particles += n;
    // Diagnostic sample selection only; every frame remains numerically checked.
    if (score > visualScore && expectedVertices.length && score > 0) {
      visualScore = score;
      visual = {
        time: frame.input.time,
        geometry: [
          {
            verticesHex: actual.vertices.toHex(),
            indicesHex: actual.indices.toHex(),
          },
        ],
      };
    }
    counts.frames++;
  }
  for (let tick = 0; tick <= 60; tick += 4) fast.advanceTo(tick / 60);
  assert.deepEqual(
    fast.checkpoint(),
    runtime.checkpoint(),
    "1x/4x canonical ticks/RNG must agree",
  );
  counts.clockChecks++;
  runtime.advanceTo(0.25);
  const quarter = runtime.checkpoint(),
    quarterDraw = runtime
      .generateDraws(camera(0.25))
      .draws.map((d) => directGeometryBuffers(d));
  for (let repeat = 0; repeat < 2; repeat++) {
    runtime.advanceTo(1);
    runtime.advanceTo(0.25);
    assert.deepEqual(
      runtime.checkpoint(),
      quarter,
      "Repeated seek restores exact state",
    );
    assert.deepEqual(
      runtime
        .generateDraws(camera(0.25))
        .draws.map((d) => directGeometryBuffers(d)),
      quarterDraw,
    );
    counts.seekChecks++;
  }
  assert(visual, "Each authored Ray must generate observable geometry");
  comparisons.push({
    effectId: c.effectId,
    emitterIndex: c.emitterIndex,
    primitiveKind: "ray",
    seedHex: c.seedHex,
    pose: c.pose,
    camera: camera(visual.time),
    visual,
  });
}
assert.equal(expected.size, 0);
assert.equal(counts.frames, 732);
for (const [path, hash] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    hash,
    "Final Ray schedule provenance",
  );
const output = `${cache}/research/direct-ray-schedule-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "compiled-runtime-ray-native-schedule-differential",
      inputs,
      counts,
      numerical,
      mismatches,
      comparisons,
      scope: {
        actualCompiledSourceAndOwnedMaterial: true,
        isolatedEmitterFromPartialRoot: true,
        sourceUnmodified: true,
        continuousEmissionAndInitialBirth: true,
        authoredSingleRaySchedule: false,
        fullRetainedBirthAndRng: true,
        allSixPackedUvHalfLanes: true,
        canonical60HzClockPolicy: true,
        originalMatchSeedRecovered: false,
        originalMatchClockRecovered: false,
        nativeSiblingCompletion: false,
        nativeWorldAcceptance: null,
        gpuDraws: false,
        browserPlayback: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ output, counts, numerical, mismatches: mismatches.length }),
);
if (mismatches.length) process.exitCode = 1;
