import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { LatestDirectEffectRuntime } from "../latest-direct-effect-runtime.mjs";
import { directGeometryBuffers } from "../latest-direct-effect-draw.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [rootArg, nativeArg, outputArg] = process.argv.slice(2);
if (!outputArg)
  throw Error(
    "Usage: bun compare-scene-legacy-shape-rotation.mjs <closed-public-root> <native-control.json> <fresh-output.json>",
  );
if (await Bun.file(outputArg).exists())
  throw Error("Fresh Legacy-shape comparison output required");
const inputs = {};
async function raw(file) {
  const bytes = await Bun.file(file).bytes(),
    path = resolve(file),
    digest = sha(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error("Legacy comparison input drift");
  inputs[path] = digest;
  return bytes;
}
await captureDirectSourceInputs([import.meta.path], raw);
const root = resolve(rootArg),
  load = (file) => raw(join(root, file)),
  native = JSON.parse(new TextDecoder().decode(await raw(nativeArg))),
  selection = await loadLatestStaticCatalogSelection({ load }),
  manifestBytes = await selection.readRole("effects"),
  image = await selection.read("decoder-16.21-macos/image.bin");
assert.equal(native.kind, "original-archived-legacy-shape-rotation-controls");
assert.equal(native.effectsManifestSha256, sha(manifestBytes));
assert.equal(native.decoderImageSha256, sha(image));
assert.equal(native.selected.beforeChanceShapeRva, 0x170aa90);
assert.equal(native.selected.afterChanceShapeRva, 0x170ab10);
for (const [file, digest] of Object.entries(native.inputs))
  assert.equal(sha(await raw(file)), digest, file);
for (const block of native.originalBlocks)
  assert.equal(
    sha(image.subarray(block.rva, block.rva + block.size)),
    block.sha256,
  );
const prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes,
    effectIds: [native.selected.effectId],
    staticCatalog: selection,
    perspective: "all",
  }),
  definition = prepared.definitions.get(native.selected.effectId),
  program = definition.emitters.find(
    (emitter) => emitter.index === native.selected.emitterIndex,
  );
assert(
  program?.legacyShapeRotationProgram,
  "Unchanged source must pass compiled Legacy shape and material admission",
);
assert.equal(
  definition.emitters.length,
  1,
  "This comparison must retain the complete admitted source definition",
);
assert.deepEqual(
  program.legacyShapeRotationProgram.angles,
  native.selected.source.SpawnShape.emitRotationAngles,
);
assert.deepEqual(
  program.legacyShapeRotationProgram.axes,
  native.selected.source.SpawnShape.emitRotationAxes,
);
const counts = {
    cases: 0,
    frames: 0,
    vertices: 0,
    packedBytes: 0,
    poolLanes: 0,
    rngStates: 0,
    originalRandomCalls: 0,
    redraws: 0,
    seeks: 0,
    negativeControls: 0,
  },
  errors = { position: 0, pool: 0 },
  mismatches = [];
const compare = (actual, expected, kind, context) => {
  const error = Math.abs(actual - expected);
  errors[kind] = Math.max(errors[kind], error);
  if (!Number.isFinite(error) || error > 0.0001)
    mismatches.push({ ...context, kind, actual, expected, error });
};
for (const control of native.cases) {
  const inputAt = (time) =>
      control.frames[
        Math.max(0, Math.min(control.frames.length - 1, Math.round(time * 60)))
      ].input,
    camera = (time) => ({
      right: inputAt(time).cameraRight,
      up: inputAt(time).cameraUp,
      position: inputAt(time).viewPosition,
    });
  const create = (data = definition) =>
    new LatestDirectEffectRuntime({
      ...prepared.contract,
      replayHash: "7".repeat(64),
      definitions: new Map([[definition.id, data]]),
      events: [
        {
          id: "original-legacy-shape-component",
          kind: "create",
          origin: "animation",
          entityId: 1,
          definitionId: definition.id,
          time: 0,
          transportSequence: 0,
          entryOrder: 0,
          seedHex: control.seedHex,
        },
      ],
      kernels: prepared.kernels,
      world: {
        placement: (_event, time) => ({
          resolved: true,
          position: inputAt(time).current,
          basis: inputAt(time).basis.filter(
            (_, index) => index < 12 && index % 4 !== 3,
          ),
        }),
      },
      checkpointSeconds: 0.125,
      maximumCheckpoints: 32,
    });
  const runtime = create();
  for (const mutate of [
    (e) => {
      delete e.legacyShapeRotationProgram;
    },
    (e) => {
      e.legacyShapeRotationProgram.rngOrder = "before-chance";
    },
    (e) => {
      e.legacyShapeRotationProgram.axes[0][0] = 1;
    },
    (e) => {
      e.offset = [1, 0, 0];
    },
    (e) => {
      e.source.SpawnShape.emitRotationAngles[0].constantValue = 0;
    },
  ]) {
    const forged = structuredClone(definition);
    mutate(forged.emitters[0]);
    assert.throws(() => create(forged));
    counts.negativeControls++;
  }
  for (const [tick, frame] of control.frames.entries()) {
    const context = {
      seedHex: control.seedHex,
      schedule: control.schedule,
      tick,
    };
    runtime.advanceTo(frame.input.time);
    const checkpoint = runtime.checkpoint(),
      packet = runtime.generateDraws(camera(frame.input.time)),
      draw = packet.draws.find((row) => row.emitterId === program.index),
      actual = draw
        ? directGeometryBuffers(draw)
        : { vertices: new Uint8Array(), indices: new Uint8Array() },
      expectedVertices = Uint8Array.fromHex(frame.output.geometry.verticesHex),
      expectedIndices = Uint8Array.fromHex(frame.output.geometry.indicesHex);
    assert.deepEqual(
      runtime.checkpoint(),
      checkpoint,
      "Redraw changed particle state/RNG",
    );
    counts.redraws++;
    if (
      actual.vertices.length !== expectedVertices.length ||
      actual.indices.length !== expectedIndices.length
    )
      mismatches.push({
        ...context,
        kind: "geometry-size",
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
      for (let offset = 0; offset < a.byteLength; offset += 28) {
        for (let lane = 0; lane < 3; lane++)
          compare(
            a.getFloat32(offset + lane * 4, true),
            e.getFloat32(offset + lane * 4, true),
            "position",
            { ...context, offset, lane },
          );
        for (let lane = 12; lane < 28; lane++) {
          if (a.getUint8(offset + lane) !== e.getUint8(offset + lane))
            mismatches.push({
              ...context,
              kind: "packed-color-uv",
              offset: offset + lane,
            });
          counts.packedBytes++;
        }
        counts.vertices++;
      }
    }
    if (
      !actual.indices.every((value, index) => value === expectedIndices[index])
    )
      mismatches.push({ ...context, kind: "indices" });
    const state = frame.output.state,
      current = checkpoint.instances[0]?.[1]?.emitters[0],
      nativeCount = state.vectors.life.count;
    if (nativeCount !== (current?.count ?? 0))
      mismatches.push({
        ...context,
        kind: "pool-count",
        actual: current?.count ?? 0,
        expected: nativeCount,
      });
    if (current) {
      const floats = (record) =>
          new Float32Array(Uint8Array.fromHex(record.hex).buffer),
        life = floats(state.vectors.life),
        motion = floats(state.vectors.motion),
        initial = floats(state.vectors.initial);
      for (
        let particle = 0;
        particle < Math.min(nativeCount, current.count);
        particle++
      )
        for (const [lane, value] of [
          [0, life[particle * 2]],
          [1, life[particle * 2 + 1]],
          ...[0, 1, 2, 3].map((lane) => [
            5 + lane,
            motion[particle * 9 + lane],
          ]),
          ...[0, 1, 2].map((lane) => [
            9 + lane,
            motion[particle * 9 + 4 + lane],
          ]),
          ...[0, 1, 2].map((lane) => [
            12 + lane,
            initial[particle * 28 + 12 + lane],
          ]),
          [18, motion[particle * 9 + 8]],
        ]) {
          compare(current.data[particle * 20 + lane], value, "pool", {
            ...context,
            particle,
            lane,
          });
          counts.poolLanes++;
        }
      const rng = new DataView(Uint8Array.fromHex(state.rngHex).buffer);
      assert.equal(current.random.draws, rng.getUint32(8, true));
      assert.equal(
        current.random.stateHex,
        rng.getBigUint64(0, true).toString(16).padStart(16, "0"),
      );
      counts.rngStates++;
    }
    for (const call of frame.afterChanceShapeCalls) {
      assert.equal(call.inputHex.slice(16), "00".repeat(36));
      assert.equal(call.outputHex.slice(16), "00".repeat(36));
    }
    if (frame.randomCalls.length) {
      assert.equal(frame.randomCalls.length, 3);
      assert.equal(frame.randomCalls[0].returnRva, 0x175a865);
      assert.equal(frame.randomCalls[1].returnRva, 0x16d8843);
      assert.equal(frame.randomCalls[2].returnRva, 0x16d8843);
      counts.originalRandomCalls += 3;
    }
    counts.frames++;
  }
  runtime.advanceTo(0.1);
  const saved = runtime.checkpoint(),
    draws = runtime.generateDraws(camera(0.1)).draws;
  runtime.advanceTo(1);
  runtime.advanceTo(0.1);
  assert.deepEqual(runtime.checkpoint(), saved);
  assert.deepEqual(runtime.generateDraws(camera(0.1)).draws, draws);
  counts.seeks++;
  counts.cases++;
}
for (const [file, digest] of Object.entries(inputs))
  assert.equal(sha(await Bun.file(file).bytes()), digest, file);
const result = {
  schema: 1,
  kind: "actual-native-legacy-shape-rotation-comparison",
  counts,
  numerical: {
    tolerance: 0.0001,
    maxPositionError: errors.position,
    maxPoolError: errors.pool,
  },
  mismatchCount: mismatches.length,
  mismatches: mismatches.slice(0, 100),
  inputs,
  sourceDrift: 0,
  scope: {
    completeSourceUnchanged: true,
    matchingPreparedMaterialRequired: true,
    originalRetainedChanceThenBothAngleProbabilities: true,
    zeroShapeVectorsOnly: true,
    explicitComponentBasisClockMotionCamera: true,
    replayActivationEstablished: false,
    webGlSubmitted: false,
    nativeSpectatorAdmitted: false,
  },
};
await Bun.write(outputArg, JSON.stringify(result));
console.log(
  JSON.stringify({
    output: outputArg,
    counts,
    numerical: result.numerical,
    mismatchCount: mismatches.length,
    sample: mismatches.slice(0, 5),
  }),
);
assert.equal(mismatches.length, 0, "Original Legacy shape comparison differs");
