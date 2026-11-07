import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { compileLatestDirectEffect } from "../latest-direct-effect-definition.mjs";
import { LatestDirectEffectRuntime } from "../latest-direct-effect-runtime.mjs";
import { directGeometryBuffers } from "../latest-direct-effect-draw.mjs";
import { directParticleWorldVector } from "../latest-direct-effect-math.mjs";
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
    throw Error(`Camera local-offset input drift:${path}`);
  inputs[path] = hash;
  return data;
}
const read = async (path) =>
    JSON.parse(new TextDecoder().decode(await raw(path))),
  load = (path) => raw(`${cache}/public/${path}`),
  floats = (hex) =>
    new Float32Array(
      Uint8Array.fromHex(typeof hex === "object" ? hex.hex : hex).buffer,
    ),
  words = (hex) => new Uint32Array(Uint8Array.fromHex(hex).buffer);
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(
    `${cache}/research/direct-camera-local-offset-native.json`,
  ),
  jitter = await read(
    `${cache}/research/direct-camera-local-offset-jitter-native.json`,
  ),
  manifestBytes = await load("latest-effects/manifest.json"),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await load("decoder-16.21-macos/image.bin");
assert.equal(
  native.kind,
  "native-camera-local-orientation-nonzero-offset-controls",
);
assert.equal(
  jitter.kind,
  "native-camera-local-orientation-interpolated-origins-controls",
);
assert.equal(await sha256(image), profile.decoderImageSha256);
for (const proof of [native, jitter]) {
  assert(proof.originalBlocks.length > 0);
  assert.equal(proof.decoderImageSha256, profile.decoderImageSha256);
  assert.equal(proof.build, profile.clientVersion);
  assert.equal(proof.protocol, profile.protocolDigest);
  for (const [path, hash] of Object.entries(proof.inputs))
    assert.equal(await sha256(await raw(path)), hash, path);
  for (const b of proof.originalBlocks)
    assert.equal(await sha256(image.subarray(b.rva, b.rva + b.size)), b.sha256);
}
const selected = [
    ["champions/gangplank/14/a558e6df", 1],
    ["champions/hecarim/0/504952c2", 4],
  ],
  ids = selected.map(([id]) => id),
  prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes,
    effectIds: ids,
  }),
  variants = new Map();
assert.equal(native.scope.onlyTypedBooleanVaried, true);
assert.equal(
  jitter.scope.constantRate180SuppliedToProduceMultipleBirthOrigins,
  true,
);
for (const proof of [native, jitter]) {
  assert.equal(proof.selected.length, selected.length);
  for (const [id, index] of selected) {
    const row = proof.selected.find(
      (r) => r.effectId === id && r.emitterIndex === index,
    );
    assert(row);
    assert.equal(row.sourceDefinitionSha256, manifest.definitions[id].sha256);
    if (proof === jitter) assert.equal(row.suppliedRate, 180);
  }
}
for (const [id, index] of selected) {
  const original = prepared.definitions.get(id);
  assert.equal(original.blockers.length, 0);
  assert(original.emitters.some((e) => e.index === index));
  variants.set(`${id}:authored`, original);
  const ref = manifest.definitions[id],
    bytes = await load(`latest-effects/${ref.file}`),
    record = JSON.parse(new TextDecoder().decode(bytes));
  assert.equal(await sha256(bytes), ref.sha256);
  record.definition.complexEmitterDefinitionData[
    index
  ].particleIsLocalOrientation = 0;
  const controlBytes = new TextEncoder().encode(JSON.stringify(record)),
    controlManifest = structuredClone(manifest);
  controlManifest.definitions[id].sha256 = await sha256(controlBytes);
  const controlManifestBytes = new TextEncoder().encode(
    JSON.stringify(controlManifest),
  );
  const control = await compileLatestDirectEffect({
    id,
    definitionBytes: controlBytes,
    manifest: controlManifest,
    manifestBytes: controlManifestBytes,
    kernels: prepared.kernels,
  });
  assert.equal(control.blockers.length, 0);
  assert(control.emitters.some((e) => e.index === index));
  variants.set(`${id}:typed-false`, control);
}
const expected = new Set();
for (const [id, index] of selected)
  for (const seed of ["0000000000000001", "0000000000012345"])
    for (const schedule of ["identity", "seven-bases"])
      for (const variant of ["authored", "typed-false"])
        expected.add(`${id}:${index}:${seed}:${schedule}:${variant}`);
const counts = {
    cases: 0,
    frames: 0,
    particles: 0,
    vertices: 0,
    colors: 0,
    halfWords: 0,
    indices: 0,
    poolLanes: 0,
    rngStates: 0,
    pauseChecks: 0,
    seekChecks: 0,
    clockChecks: 0,
    forgeryRejections: 0,
    nonzeroInterpolatedOrigins: 0,
    interpolatedOriginPositionLanes: 0,
  },
  numerical = {
    tolerance: 0.0001,
    maxPositionError: 0,
    maxPoolError: 0,
    maxInterpolatedOriginError: 0,
    incorrectRotatedOriginCounterexample: 0,
  },
  mismatches = [],
  comparisons = [];
function difference(actual, expected, context, kind) {
  const error = Math.abs(actual - expected),
    key =
      kind === "position"
        ? "maxPositionError"
        : kind === "interpolated-origin-position"
          ? "maxInterpolatedOriginError"
          : "maxPoolError";
  numerical[key] = Math.max(numerical[key], error);
  if (!Number.isFinite(error) || error > numerical.tolerance)
    mismatches.push({ ...context, kind, actual, expected, error });
}
for (const c of native.cases) {
  const key = `${c.effectId}:${c.emitterIndex}:${c.seedHex}:${c.schedule}:${c.variant}`;
  assert(
    expected.delete(key),
    "Exact unique selected component/seed/basis/flag matrix",
  );
  assert.equal(c.frames.length, 61);
  assert(c.observedBirths > 0 && c.positiveAreaColoredFrames > 0);
  const definition = variants.get(`${c.effectId}:${c.variant}`),
    program = definition.emitters.find((e) => e.index === c.emitterIndex),
    isolated = { ...definition, emitters: [program] };
  assert.equal(program.primitive, "camera-quad");
  assert.equal(
    program.cameraLocalOffsetProgram.useCurrentRootBasis,
    c.variant === "authored",
  );
  assert.equal(program.placementRequirements.rootBasis, true);
  const inputAt = (time) =>
      c.frames[Math.min(60, Math.max(0, Math.round(time * 60)))].input,
    camera = (time) => {
      const v = inputAt(time);
      return { right: v.cameraRight, up: v.cameraUp, position: v.viewPosition };
    },
    create = (control = isolated) =>
      new LatestDirectEffectRuntime({
        ...prepared.contract,
        contentHash: definition.contentHash,
        replayHash: "7".repeat(64),
        definitions: new Map([[definition.id, control]]),
        kernels: prepared.kernels,
        events: [
          {
            id: `camera-local:${key}`,
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
          placement: (_event, time) => {
            const v = inputAt(time);
            return {
              resolved: true,
              position: v.current,
              basis: v.basis.filter((_, i) => i < 12 && i % 4 !== 3),
            };
          },
        },
        checkpointSeconds: 0.125,
        maximumCheckpoints: 32,
      }),
    runtime = create(),
    fast = create();
  for (const mutate of [
    (e) => delete e.cameraLocalOffsetProgram,
    (e) =>
      (e.cameraLocalOffsetProgram.useCurrentRootBasis =
        !e.cameraLocalOffsetProgram.useCurrentRootBasis),
    (e) => (e.placementRequirements.rootBasis = false),
    (e) => (e.bound = false),
    (e) => (e.velocity = [0, 0, 0]),
  ]) {
    const altered = structuredClone(isolated);
    mutate(altered.emitters[0]);
    assert.throws(() => create(altered));
    counts.forgeryRejections++;
  }
  let visual = null,
    peak = -1;
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
      "Camera redraw must preserve particle/RNG state",
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
      mismatches.push({ ...context, kind: "index-count" });
    const a = new DataView(
        actual.vertices.buffer,
        actual.vertices.byteOffset,
        actual.vertices.byteLength,
      ),
      e = new DataView(
        expectedVertices.buffer,
        expectedVertices.byteOffset,
        expectedVertices.byteLength,
      );
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
            mismatches.push({ ...context, kind: "packed-uv", byte: at + lane });
          counts.halfWords++;
        }
        score = Math.max(
          score,
          program.blend === 0
            ? e.getUint8(at + 12) + e.getUint8(at + 13) + e.getUint8(at + 14)
            : e.getUint8(at + 15),
        );
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
      current = saved.instances[0]?.[1]?.emitters[0];
    if (n !== (current?.count ?? 0))
      mismatches.push({
        ...context,
        kind: "pool-count",
        actual: current?.count ?? 0,
        expected: n,
      });
    if (current) {
      const life = floats(nativeState.vectors.life),
        motion = floats(nativeState.vectors.motion),
        initial = floats(nativeState.vectors.initial);
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
        seed = draws ? rng.getBigUint64(0, true) : BigInt(`0x${c.seedHex}`);
      if (
        current.random.draws !== draws ||
        current.random.stateHex !== seed.toString(16).padStart(16, "0")
      )
        mismatches.push({ ...context, kind: "rng" });
      counts.rngStates++;
    }
    counts.particles += n;
    counts.frames++;
    let positiveArea = false;
    for (let at = 0; at < expectedVertices.length && !positiveArea; at += 112) {
      const p = (v, l) => e.getFloat32(at + v * 28 + l * 4, true),
        ab = [0, 1, 2].map((l) => p(1, l) - p(0, l)),
        ac = [0, 1, 2].map((l) => p(2, l) - p(0, l)),
        cross = [
          ab[1] * ac[2] - ab[2] * ac[1],
          ab[2] * ac[0] - ab[0] * ac[2],
          ab[0] * ac[1] - ab[1] * ac[0],
        ];
      positiveArea = cross.every(Number.isFinite) && cross.some((n) => n !== 0);
    }
    if (score > peak && score > 0 && expectedIndices.length && positiveArea) {
      peak = score;
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
  }
  for (let tick = 0; tick <= 60; tick += 4) fast.advanceTo(tick / 60);
  assert.deepEqual(
    fast.checkpoint(),
    runtime.checkpoint(),
    "1x/4x canonical state",
  );
  counts.clockChecks++;
  runtime.advanceTo(0.25);
  const quarter = runtime.checkpoint(),
    quarterDraw = runtime.generateDraws(camera(0.25)).draws;
  for (let repeat = 0; repeat < 2; repeat++) {
    runtime.advanceTo(1);
    runtime.advanceTo(0.25);
    assert.deepEqual(runtime.checkpoint(), quarter);
    assert.deepEqual(runtime.generateDraws(camera(0.25)).draws, quarterDraw);
    counts.seekChecks++;
  }
  assert(
    visual,
    "Every compiled authored/control component must produce observable indexed geometry",
  );
  comparisons.push({
    effectId: c.effectId,
    emitterIndex: c.emitterIndex,
    primitiveKind: "camera",
    seedHex: c.seedHex,
    schedule: c.schedule,
    variant: c.variant,
    camera: camera(visual.time),
    visual,
  });
  counts.cases++;
}
assert.equal(expected.size, 0);
assert.equal(counts.frames, 976);
const jitterExpected = new Set(
  selected.flatMap(([id, index]) =>
    ["authored", "typed-false"].map((variant) => `${id}:${index}:${variant}`),
  ),
);
for (const c of jitter.cases) {
  assert(jitterExpected.delete(`${c.effectId}:${c.emitterIndex}:${c.variant}`));
  assert.equal(c.seedHex, "0000000000000001");
  assert.equal(c.schedule, "seven-bases");
  assert.equal(c.frames.length, 17);
  const origins = new Map();
  for (const [tick, frame] of c.frames.entries()) {
    const v = frame.output.state.vectors,
      ordinals = words(v.ordinal.hex),
      births = frame.output.state.births,
      input = frame.input;
    for (const [i, birth] of births.entries()) {
      const root = floats(birth.birthHex).subarray(12, 15),
        ordinal = ordinals[ordinals.length - births.length + i],
        origin = Array.from(root, (n, l) => f(n - f(input.current[l])));
      origins.set(ordinal, origin);
      if (origin.some((n) => n !== 0)) counts.nonzeroInterpolatedOrigins++;
    }
    if (c.variant !== "authored") continue;
    const particle = floats(v.particle),
      initial = floats(v.initial),
      basis = input.basis.filter((_, i) => i < 12 && i % 4 !== 3);
    for (const [i, ordinal] of ordinals.entries()) {
      const origin = origins.get(ordinal);
      assert(origin);
      const offset = Array.from(initial.subarray(i * 28 + 3, i * 28 + 6)),
        translated = directParticleWorldVector(offset, basis),
        wrong = directParticleWorldVector(
          offset.map((n, l) => f(n + origin[l])),
          basis,
        );
      for (let l = 0; l < 3; l++) {
        const actual = particle[i * 43 + 32 + l];
        difference(
          f(f(input.current[l]) + f(origin[l] + translated[l])),
          actual,
          { effectId: c.effectId, tick, ordinal, lane: l },
          "interpolated-origin-position",
        );
        numerical.incorrectRotatedOriginCounterexample = Math.max(
          numerical.incorrectRotatedOriginCounterexample,
          Math.abs(f(f(input.current[l]) + wrong[l]) - actual),
        );
        counts.interpolatedOriginPositionLanes++;
      }
    }
  }
}
assert.equal(jitterExpected.size, 0);
assert(counts.nonzeroInterpolatedOrigins > 0);
assert(numerical.incorrectRotatedOriginCounterexample > 1);
for (const [path, hash] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), hash, path);
const output = `${cache}/research/direct-camera-local-offset-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "compiled-camera-local-offset-native-schedule-differential",
      inputs,
      counts,
      numerical,
      mismatches,
      comparisons,
      scope: {
        actualCompiledAuthoredSources: true,
        typedFalseSingleFieldCompilerControls: true,
        fullIndexedCameraGeometry: true,
        allSixPackedUvHalfLanes: true,
        mappedRetainedBirthPoolAndRng: true,
        nativeOrientationAndDerivedVelocityStreamsUnconsumed: true,
        separateRate180InterpolationControl: true,
        canonical60HzPresentationClock: true,
        originalMatchClockRecovered: false,
        originalMatchSeedRecovered: false,
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
