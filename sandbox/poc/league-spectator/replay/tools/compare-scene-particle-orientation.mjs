import { resolve, join } from "node:path";
import { strict as assert } from "node:assert";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { compileLatestDirectEffect } from "../latest-direct-effect-definition.mjs";
import { LatestDirectEffectRuntime } from "../latest-direct-effect-runtime.mjs";
import { directGeometryBuffers } from "../latest-direct-effect-draw.mjs";
import {
  directParticleBasis,
  directParticleWorldBasis,
} from "../latest-direct-effect-math.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [rootArg, proofArg, output, mode] = process.argv.slice(2);
if (mode !== undefined && mode !== "--component-only")
  throw Error(
    "Explicit --component-only mode or matching prepared materials required",
  );
const componentOnly = mode === "--component-only";
if (!output)
  throw Error(
    "Usage: bun compare-scene-particle-orientation.mjs <closed-public-root> <native-control.json> <output.json>",
  );
const root = resolve(rootArg),
  inputs = {},
  read = async (file) => {
    const bytes = await Bun.file(file).bytes();
    const digest = sha(bytes);
    if (inputs[resolve(file)] && inputs[resolve(file)] !== digest)
      throw Error("Orientation comparison input drift");
    inputs[resolve(file)] = digest;
    return bytes;
  },
  decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes)),
  load = (file) => read(join(root, file));
await captureDirectSourceInputs([import.meta.path], read);
const native = decode(await read(proofArg)),
  selection = await loadLatestStaticCatalogSelection({ load }),
  manifestBytes = await selection.readRole("effects"),
  manifest = decode(manifestBytes),
  image = await selection.read("decoder-16.21-macos/image.bin"),
  profile = selection.profile();
assert.equal(native.kind, "original-archived-arbitrary-particle-orientation");
assert.equal(native.effectsManifestSha256, sha(manifestBytes));
assert.equal(native.decoderImageSha256, sha(image));
assert.equal(native.decoderImageSha256, profile.decoderImageSha256);
for (const [file, digest] of Object.entries(native.inputs))
  assert.equal(sha(await read(file)), digest, file);
for (const block of native.originalBlocks)
  assert.equal(
    sha(image.subarray(block.rva, block.rva + block.size)),
    block.sha256,
  );
const ids = [...new Set(native.selected.map((row) => row.effectId))],
  prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes,
    effectIds: ids,
    staticCatalog: selection,
    perspective: "all",
  }),
  counts = {
    cases: 0,
    frames: 0,
    vertices: 0,
    packedBytes: 0,
    poolLanes: 0,
    rngStates: 0,
    redraws: 0,
    seeks: 0,
    speedChecks: 0,
    negativeControls: 0,
  },
  numerical = {
    tolerance: 0.0001,
    maxPositionError: 0,
    maxMatrixError: 0,
    maxPoolError: 0,
  },
  mismatches = [],
  comparisons = [];
function difference(actual, expected, field, context) {
  const error = Math.abs(actual - expected),
    key =
      field === "position"
        ? "maxPositionError"
        : field === "matrix"
          ? "maxMatrixError"
          : "maxPoolError";
  numerical[key] = Math.max(numerical[key], error);
  if (!Number.isFinite(error) || error > numerical.tolerance)
    mismatches.push({ ...context, field, actual, expected, error });
}
const floats = (value) =>
  new Float32Array(Uint8Array.fromHex(value.hex ?? value).buffer);
for (const c of native.cases.filter((row) => row.variant === "authored")) {
  // Explicit component diagnostics may compile the unchanged source with the
  // real prepared numeric kernels. They do not pass the package's separate
  // material-admission filter and never establish material-backed coverage.
  const definition = componentOnly
      ? await compileLatestDirectEffect({
          id: c.effectId,
          definitionBytes: await selection.read(
            `latest-effects/${manifest.definitions[c.effectId].file}`,
          ),
          manifest,
          manifestBytes,
          kernels: prepared.kernels,
        })
      : prepared.definitions.get(c.effectId),
    program = definition.emitters.find((row) => row.index === c.emitterIndex);
  assert.deepEqual(
    definition.blockers,
    [],
    "Original system blockers: " + JSON.stringify(definition.blockers),
  );
  assert(
    program,
    componentOnly
      ? "Actual source component must compile without field alterations"
      : "Actual authored material must compile without source alterations",
  );
  assert.equal(
    program.arbitraryLocalOrientationProgram.useCurrentRootBasisForAxes,
    true,
  );
  const isolated = { ...definition, emitters: [program] },
    inputAt = (time) =>
      c.frames[
        Math.min(c.frames.length - 1, Math.max(0, Math.round(time * 60)))
      ].input,
    camera = (time) => {
      const v = inputAt(time);
      return { right: v.cameraRight, up: v.cameraUp, position: v.viewPosition };
    },
    create = (data = isolated) =>
      new LatestDirectEffectRuntime({
        ...prepared.contract,
        contentHash: definition.contentHash,
        replayHash: "8".repeat(64),
        definitions: new Map([[definition.id, data]]),
        kernels: prepared.kernels,
        events: [
          {
            id: "native-orientation-component",
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
              basis: v.basis.filter(
                (_, index) => index < 12 && index % 4 !== 3,
              ),
            };
          },
        },
        checkpointSeconds: 0.125,
        maximumCheckpoints: 32,
      }),
    runtime = create(),
    fast = create();
  for (const alter of [
    (e) => delete e.arbitraryLocalOrientationProgram,
    (e) =>
      (e.arbitraryLocalOrientationProgram.useCurrentRootBasisForAxes = false),
    (e) =>
      (e.arbitraryLocalOrientationProgram.useCurrentRootBasisForPosition =
        !e.arbitraryLocalOrientationProgram.useCurrentRootBasisForPosition),
    (e) => (e.placementRequirements.rootBasis = false),
    (e) => (e.inheritSystemBasis = false),
  ]) {
    const forged = structuredClone(isolated);
    alter(forged.emitters[0]);
    assert.throws(() => create(forged));
    counts.negativeControls++;
  }
  let nonemptyFrames = 0;
  for (const [tick, frame] of c.frames.entries()) {
    const context = {
      effectId: c.effectId,
      seed: c.seedHex,
      schedule: c.schedule,
      tick,
    };
    runtime.advanceTo(frame.input.time);
    const saved = runtime.checkpoint(),
      packet = runtime.generateDraws(camera(frame.input.time)),
      draw = packet.draws.find((row) => row.emitterId === program.index),
      actual = draw
        ? directGeometryBuffers(draw)
        : { vertices: new Uint8Array(), indices: new Uint8Array() },
      expectedVertices = Uint8Array.fromHex(frame.output.geometry.verticesHex),
      expectedIndices = Uint8Array.fromHex(frame.output.geometry.indicesHex);
    assert.deepEqual(runtime.checkpoint(), saved);
    counts.redraws++;
    if (
      actual.vertices.length !== expectedVertices.length ||
      actual.indices.length !== expectedIndices.length
    )
      mismatches.push({
        ...context,
        field: "geometry-size",
        actual: [actual.vertices.length, actual.indices.length],
        expected: [expectedVertices.length, expectedIndices.length],
      });
    if (actual.vertices.length === expectedVertices.length) {
      const a = new DataView(
          actual.vertices.buffer,
          actual.vertices.byteOffset,
          actual.vertices.byteLength,
        ),
        e = new DataView(expectedVertices.buffer);
      for (let offset = 0; offset < expectedVertices.length; offset += 28) {
        for (let lane = 0; lane < 3; lane++)
          difference(
            a.getFloat32(offset + lane * 4, true),
            e.getFloat32(offset + lane * 4, true),
            "position",
            { ...context, vertex: offset / 28, lane },
          );
        for (let lane = 12; lane < 28; lane++) {
          if (a.getUint8(offset + lane) !== e.getUint8(offset + lane))
            mismatches.push({
              ...context,
              field: "packed-color-uv",
              offset: offset + lane,
            });
          counts.packedBytes++;
        }
        counts.vertices++;
      }
    }
    if (
      actual.indices.length === expectedIndices.length &&
      !actual.indices.every((value, index) => value === expectedIndices[index])
    )
      mismatches.push({ ...context, field: "indices" });
    const state = frame.output.state,
      n = state.vectors.life.count,
      current = saved.instances[0]?.[1]?.emitters[0];
    if (n !== (current?.count ?? 0))
      mismatches.push({
        ...context,
        field: "pool-count",
        actual: current?.count ?? 0,
        expected: n,
      });
    if (current) {
      const life = floats(state.vectors.life),
        motion = floats(state.vectors.motion),
        initial = floats(state.vectors.initial),
        matrices = floats(state.vectors.matrices);
      for (let i = 0; i < Math.min(n, current.count); i++) {
        for (const [lane, value] of [
          [0, life[i * 2]],
          [1, life[i * 2 + 1]],
          ...[0, 1, 2, 3].map((lane) => [5 + lane, motion[i * 9 + lane]]),
          ...[0, 1, 2].map((lane) => [9 + lane, motion[i * 9 + 4 + lane]]),
          ...[0, 1, 2].map((lane) => [12 + lane, initial[i * 28 + 12 + lane]]),
          [18, motion[i * 9 + 8]],
        ]) {
          difference(current.data[i * 20 + lane], value, "pool", {
            ...context,
            particle: i,
            lane,
          });
          counts.poolLanes++;
        }
        const rotation = Array.from(
            current.data.subarray(i * 20 + 12, i * 20 + 15),
          ),
          basis = frame.input.basis.filter(
            (_, index) => index < 12 && index % 4 !== 3,
          ),
          expectedBasis = directParticleWorldBasis(
            directParticleBasis(rotation),
            basis,
          );
        for (let axis = 0; axis < 3; axis++)
          for (let lane = 0; lane < 3; lane++)
            difference(
              expectedBasis[axis][lane],
              matrices[i * 16 + axis * 4 + lane],
              "matrix",
              { ...context, particle: i, axis, lane },
            );
      }
      const rng = new DataView(Uint8Array.fromHex(state.rngHex).buffer),
        draws = rng.getUint32(8, true),
        seed = draws ? rng.getBigUint64(0, true) : BigInt(`0x${c.seedHex}`);
      if (
        current.random.draws !== draws ||
        current.random.stateHex !== seed.toString(16).padStart(16, "0")
      )
        mismatches.push({ ...context, field: "rng" });
      counts.rngStates++;
    }
    if (actual.indices.length) nonemptyFrames++;
    counts.frames++;
  }
  assert(nonemptyFrames > 0);
  for (let tick = 0; tick < c.frames.length; tick += 4)
    fast.advanceTo(c.frames[tick].input.time);
  fast.advanceTo(c.frames.at(-1).input.time);
  assert.deepEqual(fast.checkpoint(), runtime.checkpoint());
  counts.speedChecks++;
  runtime.advanceTo(0.25);
  const quarter = runtime.checkpoint(),
    quarterDraw = runtime.generateDraws(camera(0.25)).draws;
  for (let repeat = 0; repeat < 2; repeat++) {
    runtime.advanceTo(1);
    runtime.advanceTo(0.25);
    assert.deepEqual(runtime.checkpoint(), quarter);
    assert.deepEqual(runtime.generateDraws(camera(0.25)).draws, quarterDraw);
    counts.seeks++;
  }
  comparisons.push({
    effectId: c.effectId,
    emitterIndex: c.emitterIndex,
    seedHex: c.seedHex,
    schedule: c.schedule,
    nonemptyFrames,
  });
  counts.cases++;
}
assert(counts.cases > 0);
for (const [file, digest] of Object.entries(inputs))
  assert.equal(sha(await Bun.file(file).bytes()), digest, file);
const result = {
  schema: 1,
  kind: "actual-archived-arbitrary-local-orientation-comparison",
  counts,
  numerical,
  mismatchCount: mismatches.length,
  mismatches: mismatches.slice(0, 100),
  comparisons,
  inputs,
  scope: {
    actualSourceUnchanged: true,
    componentOnly,
    matchingPreparedMaterialRequired: !componentOnly,
    nativeComponentGeometryCompared: true,
    explicitSuppliedWorldBasis: true,
    replayActivationEstablished: false,
    webGlSubmitted: false,
    nativeSpectatorAdmitted: false,
  },
};
await Bun.write(output, JSON.stringify(result));
console.log(
  JSON.stringify({
    output,
    counts,
    numerical,
    mismatchCount: mismatches.length,
    sample: mismatches.slice(0, 5),
  }),
);
assert.equal(
  mismatches.length,
  0,
  "Every native component frame, packed color/UV, retained pool and RNG must match",
);
