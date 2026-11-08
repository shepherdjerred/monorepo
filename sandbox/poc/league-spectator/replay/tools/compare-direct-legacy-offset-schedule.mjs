import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { LatestDirectEffectRuntime } from "../latest-direct-effect-runtime.mjs";
import { directGeometryBuffers } from "../latest-direct-effect-draw.mjs";
import {
  compileDirectLegacyOffsetProgram,
  sampleDirectLegacyOffset,
  DIRECT_LEGACY_OFFSET_OMISSION,
} from "../latest-direct-effect-legacy-offset.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Legacy input drift:${path}`);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
    JSON.parse(new TextDecoder().decode(await raw(path))),
  load = (path) => raw(`${cache}/public/${path}`),
  floats = (hex) =>
    new Float32Array(
      Uint8Array.fromHex(typeof hex === "object" ? hex.hex : hex).buffer,
    );
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(`${cache}/research/direct-legacy-offset-native.json`),
  manifestBytes = await load("latest-effects/manifest.json"),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await load("decoder-16.21-macos/image.bin");
assert.equal(native.kind, "original-legacy-offset-complete-emitter-controls");
assert.equal(native.build, profile.clientVersion);
assert.equal(native.protocol, profile.protocolDigest);
assert.equal(native.decoderImageSha256, profile.decoderImageSha256);
assert.equal(await sha256(image), profile.decoderImageSha256);
assert.equal(native.scope.completeUnchangedTypedSourceAndOrder, true);
assert(native.originalBlocks.length > 0);
for (const target of [0x170a850, 0x17591fc])
  assert(
    native.originalBlocks.some(
      (b) => b.rva <= target && b.rva + b.size > target,
    ),
  );
for (const [path, hash] of Object.entries(native.inputs))
  assert.equal(await sha256(await raw(path)), hash, path);
for (const b of native.originalBlocks)
  assert.equal(await sha256(image.subarray(b.rva, b.rva + b.size)), b.sha256);
const id = "champions/vladimir/39/9fbafd14",
  indices = [3, 6, 10],
  prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes,
    effectIds: [id],
  }),
  definition = prepared.definitions.get(id);
assert.equal(definition.blockers.length, 0);
assert.equal(native.selected.length, 3);
const selected = new Map();
for (const row of native.selected) {
  assert.equal(row.effectId, id);
  assert(indices.includes(row.emitterIndex) && !selected.has(row.emitterIndex));
  assert.equal(row.sourceDefinitionSha256, manifest.definitions[id].sha256);
  selected.set(row.emitterIndex, row);
}
const counts = {
    cases: 0,
    frames: 0,
    vertices: 0,
    colors: 0,
    halfWords: 0,
    indices: 0,
    particles: 0,
    poolLanes: 0,
    rngStates: 0,
    pauseChecks: 0,
    seekChecks: 0,
    clockChecks: 0,
    forgeryRejections: 0,
    actualLeaves: 0,
    typedLeaves: 0,
    signedZeroPoolDifferences: 0,
    signedZeroPositionDifferences: 0,
    signedZeroActualLeafDifferences: 0,
    signedZeroTypedLeafDifferences: 0,
  },
  numerical = {
    tolerance: 0.0001,
    maxPositionError: 0,
    maxPoolError: 0,
    maxLeafError: 0,
  },
  mismatches = [],
  comparisons = [];
function difference(actual, expected, context, kind) {
  const error = Math.abs(actual - expected),
    key =
      kind === "position"
        ? "maxPositionError"
        : kind === "leaf"
          ? "maxLeafError"
          : "maxPoolError";
  numerical[key] = Math.max(numerical[key], error);
  if (actual === 0 && expected === 0 && !Object.is(actual, expected))
    counts[
      kind === "position"
        ? "signedZeroPositionDifferences"
        : kind === "leaf"
          ? context.typed
            ? "signedZeroTypedLeafDifferences"
            : "signedZeroActualLeafDifferences"
          : "signedZeroPoolDifferences"
    ]++;
  if (!Number.isFinite(error) || error > numerical.tolerance)
    mismatches.push({ ...context, kind, actual, expected, error });
}
const leafClocks = [
    -1, 0, 0.01, 0.125, 0.34999999, 0.5, 0.699999988079071, 0.7, 0.8, 1, 2, 100,
  ],
  leafKeys = new Set(
    indices.flatMap((index) => leafClocks.map((clock) => `${index}:${clock}`)),
  );
for (const row of native.leaves) {
  assert.equal(row.effectId, id);
  assert(leafKeys.delete(`${row.emitterIndex}:${row.clock}`));
  assert.equal(row.rngBeforeHex, row.rngAfterHex);
  assert.equal(row.calls.length, 1);
  const source = selected.get(row.emitterIndex).source,
    program = compileDirectLegacyOffsetProgram(
      source.SpawnShape,
      "arbitrary-quad",
    );
  assert(program);
  const sampled = sampleDirectLegacyOffset(
      program,
      row.clock,
      prepared.kernels.values,
    ),
    expected = floats(row.outputHex);
  for (let lane = 0; lane < 3; lane++)
    difference(
      sampled[lane],
      expected[lane],
      { index: row.emitterIndex, clock: row.clock, lane },
      "leaf",
    );
  counts.actualLeaves++;
}
assert.equal(leafKeys.size, 0);
const typedClocks = [-1, 0, 0.25, 0.699999988079071, 1, 2],
  typedKeys = new Set(
    Array.from({ length: 5 }, (_, i) =>
      typedClocks.map((clock) => `${i}:${clock}`),
    ).flat(),
  );
const typedVariants = [
  {
    constant: [2, -3, -4],
    curve: [
      [5, 6, 7],
      [10, 12, 14],
    ],
  },
  {
    constant: [-2, 3, 4],
    curve: [
      [5, 6, 7],
      [10, 12, 14],
    ],
  },
  {
    constant: [0, 0, 0],
    curve: [
      [5, 6, 7],
      [10, 12, 14],
    ],
  },
  {
    constant: [2, -3, -4],
    curve: [
      [0, 0, 0],
      [1, 2, 3],
    ],
  },
  {
    constant: [2, -3, -4],
    curve: [
      [-0, -0, -0],
      [1, 2, 3],
    ],
  },
];
for (const row of native.typedControls) {
  assert(typedKeys.delete(`${row.control}:${row.clock}`));
  assert.deepEqual(row.constant, typedVariants[row.control].constant);
  assert.deepEqual(row.curve, typedVariants[row.control].curve);
  assert.deepEqual(row.times, [0, 0.699999988079071]);
  assert.equal(row.rngBeforeHex, row.rngAfterHex);
  const program = compileDirectLegacyOffsetProgram(
    {
      __type: "VfxShapeLegacy",
      emitOffset: {
        __type: "ValueVector3",
        constantValue: row.constant,
        dynamics: {
          __type: "VfxAnimatedVector3fVariableData",
          times: row.times,
          values: row.curve,
        },
      },
    },
    "arbitrary-quad",
  );
  assert(program);
  const sampled = sampleDirectLegacyOffset(
      program,
      row.clock,
      prepared.kernels.values,
    ),
    expected = floats(row.outputHex);
  for (let lane = 0; lane < 3; lane++)
    difference(
      sampled[lane],
      expected[lane],
      { typed: true, control: row.control, clock: row.clock, lane },
      "leaf",
    );
  counts.typedLeaves++;
}
assert.equal(typedKeys.size, 0);
const expectedCases = new Set(
  indices.flatMap((index) =>
    ["0000000000000001", "0000000000012345"].flatMap((seed) =>
      ["identity", "changing"].map((pose) => `${index}:${seed}:${pose}`),
    ),
  ),
);
for (const c of native.cases) {
  assert.equal(c.effectId, id);
  const key = `${c.emitterIndex}:${c.seedHex}:${c.pose}`;
  assert(expectedCases.delete(key));
  assert.equal(c.frames.length, 31);
  assert(c.observedBirths > 0 && c.positiveAreaColoredFrames > 0);
  const program = definition.emitters.find((e) => e.index === c.emitterIndex);
  assert(program?.legacyOffsetProgram);
  assert.deepEqual(program.source, selected.get(c.emitterIndex).source);
  assert.equal(program.offset, null);
  assert.equal(program.placementRequirements.rootBasis, true);
  assert(program.omissions.includes(DIRECT_LEGACY_OFFSET_OMISSION));
  const isolated = { ...definition, emitters: [program] },
    inputAt = (time) =>
      c.frames[Math.min(30, Math.max(0, Math.round(time * 60)))].input,
    camera = (time) => ({
      right: [1, 0, 0],
      up: [0, 1, 0],
      position: inputAt(time).viewPosition,
    }),
    create = (control = isolated) =>
      new LatestDirectEffectRuntime({
        ...prepared.contract,
        replayHash: "a".repeat(64),
        definitions: new Map([[id, control]]),
        kernels: prepared.kernels,
        events: [
          {
            id: `legacy:${key}`,
            kind: "create",
            origin: "animation",
            entityId: 1,
            definitionId: id,
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
    (e) => delete e.legacyOffsetProgram,
    (e) => (e.legacyOffsetProgram.clock = "replay-time"),
    (e) => (e.offset = [0, 0, 0]),
    (e) => (e.placementRequirements.rootBasis = false),
    (e) => (e.legacyOffsetProgram.field.constantValue[0] = 123),
  ]) {
    const altered = structuredClone(isolated);
    mutate(altered.emitters[0]);
    assert.throws(() => create(altered));
    counts.forgeryRejections++;
  }
  let visual = null,
    peak = -1;
  for (const [tick, frame] of c.frames.entries()) {
    runtime.advanceTo(frame.input.time);
    const saved = runtime.checkpoint(),
      draw = runtime
        .generateDraws(camera(frame.input.time))
        .draws.find((d) => d.emitterId === program.index),
      actual = draw
        ? directGeometryBuffers(draw)
        : { vertices: new Uint8Array(0), indices: new Uint8Array(0) },
      ev = Uint8Array.fromHex(frame.output.geometry.verticesHex),
      ei = Uint8Array.fromHex(frame.output.geometry.indicesHex),
      context = { key, tick };
    assert.deepEqual(runtime.checkpoint(), saved);
    counts.pauseChecks++;
    if (actual.vertices.length !== ev.length)
      mismatches.push({
        ...context,
        kind: "vertex-count",
        actual: actual.vertices.length,
        expected: ev.length,
      });
    if (actual.indices.length !== ei.length)
      mismatches.push({ ...context, kind: "index-count" });
    const a = new DataView(
        actual.vertices.buffer,
        actual.vertices.byteOffset,
        actual.vertices.byteLength,
      ),
      e = new DataView(ev.buffer);
    let score = 0;
    if (actual.vertices.length === ev.length)
      for (let at = 0; at < ev.length; at += 28) {
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
    for (let i = 0; i < Math.min(actual.indices.length, ei.length); i++)
      if (actual.indices[i] !== ei[i])
        mismatches.push({ ...context, kind: "index", byte: i });
    counts.indices += ei.length / 2;
    const state = frame.output.state,
      n = state.vectors.life.count,
      current = saved.instances[0]?.[1]?.emitters[0];
    if (n !== (current?.count ?? 0))
      mismatches.push({
        ...context,
        kind: "pool-count",
        actual: current?.count ?? 0,
        expected: n,
      });
    if (current) {
      const life = floats(state.vectors.life),
        motion = floats(state.vectors.motion),
        initial = floats(state.vectors.initial);
      for (let i = 0; i < Math.min(n, current.count); i++) {
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
        for (let lane = 0; lane < 3; lane++) {
          difference(
            current.motion[i * 6 + lane],
            initial[i * 28 + 3 + lane],
            { ...context, particle: i, lane, stream: "local-offset" },
            "retained-pool",
          );
          counts.poolLanes++;
        }
      }
      const rng = new DataView(Uint8Array.fromHex(state.rngHex).buffer),
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
    for (let at = 0; at + 112 <= ev.length && !positiveArea; at += 112) {
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
    if (score > peak && score > 0 && ei.length && positiveArea) {
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
  for (let tick = 0; tick <= 28; tick += 4) fast.advanceTo(tick / 60);
  fast.advanceTo(0.5);
  assert.deepEqual(fast.checkpoint(), runtime.checkpoint());
  counts.clockChecks++;
  runtime.advanceTo(0.125);
  const saved = runtime.checkpoint(),
    draws = runtime.generateDraws(camera(0.125)).draws;
  for (let repeat = 0; repeat < 2; repeat++) {
    runtime.advanceTo(0.5);
    runtime.advanceTo(0.125);
    assert.deepEqual(runtime.checkpoint(), saved);
    assert.deepEqual(runtime.generateDraws(camera(0.125)).draws, draws);
    counts.seekChecks++;
  }
  assert(visual);
  comparisons.push({
    effectId: id,
    emitterIndex: c.emitterIndex,
    primitiveKind: "loaded",
    seedHex: c.seedHex,
    pose: c.pose,
    camera: camera(visual.time),
    visual,
  });
  counts.cases++;
}
assert.equal(expectedCases.size, 0);
assert.equal(counts.frames, 372);
assert.equal(counts.actualLeaves, 36);
assert.equal(counts.typedLeaves, 30);
for (const [path, hash] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), hash, path);
const output = `${cache}/research/direct-legacy-offset-schedule-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "compiled-legacy-offset-native-schedule-differential",
      inputs,
      counts,
      numerical,
      mismatches,
      comparisons,
      scope: {
        actualCompiledUnchangedSources: true,
        fullIndexedGeometry: true,
        allSixPackedUvHalfLanes: true,
        mappedPoolNumericComparison: true,
        rawPoolBitExact: false,
        preparedJsonSignedZeroLossExplicit: true,
        typedNonzeroAbsoluteCurveControls: true,
        noAdditionalShapeRng: true,
        canonical60HzPresentationClock: true,
        nativeSiblingCompletion: false,
        nativeWorldAcceptance: null,
        originalMatchSeedRecovered: false,
        originalMatchClockRecovered: false,
        gpuDraws: false,
        browserPlayback: false,
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
    numerical,
    mismatches: mismatches.length,
    first: mismatches[0],
  }),
);
if (mismatches.length) process.exitCode = 1;
