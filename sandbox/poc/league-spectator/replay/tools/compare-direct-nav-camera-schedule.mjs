import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { LatestDirectEffectRuntime } from "../latest-direct-effect-runtime.mjs";
import { directRenderAttributes } from "../latest-direct-effect-draw.mjs";
import { compareDirectQuadUv } from "./direct-quad-uv-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash) throw Error(`Input drift:${path}`);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
    JSON.parse(new TextDecoder().decode(await raw(path))),
  load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(
  `${cache}/research/direct-nav-camera-schedule-native-v37.json`,
);
assert.equal(
  native.kind,
  "original-camera-navigation-emitter-schedule-controls",
);
assert.equal(native.cases.length, 4);
for (const [path, hash] of Object.entries(native.inputs))
  assert.equal(await sha256(await raw(path)), hash, path);
const image = await load("decoder-16.21-macos/image.bin");
assert.equal(await sha256(image), native.decoderImageSha256);
for (const b of native.originalBlocks)
  assert.equal(await sha256(image.subarray(b.rva, b.rva + b.size)), b.sha256);
const prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes: await load("latest-effects/manifest.json"),
    effectIds: ["champions/karthus/10/8ad0cea5"],
  }),
  definition = prepared.definitions.get("champions/karthus/10/8ad0cea5"),
  program = definition.emitters.find((e) => e.index === 7);
assert(program?.navGroundProgram);
assert.equal(program.primitive, "camera-quad");
assert.equal(definition.blockers.length, 0);
const mismatches = [],
  cases = [],
  counts = {
    frames: 0,
    vertices: 0,
    colors: 0,
    uvHalfwords: 0,
    indices: 0,
    rngStates: 0,
    cameraStateChecks: 0,
    checkpointChecks: 0,
    backwardSeekChecks: 0,
  };
let maxPositionError = 0;
const camera = (frame) => ({
  right: frame.input.cameraRight,
  up: frame.input.cameraUp,
});
for (const reference of native.cases) {
  assert.equal(reference.effectId, definition.id);
  assert.equal(reference.emitterIndex, program.index);
  assert.equal(reference.sourceDefinitionSha256, definition.definitionHash);
  const isolated = { ...definition, emitters: [program], unsupported: [] },
    runtime = new LatestDirectEffectRuntime({
      ...prepared.contract,
      replayHash: "0".repeat(64),
      definitions: new Map([[definition.id, isolated]]),
      kernels: prepared.kernels,
      events: [
        {
          id: "nav-camera-control:0",
          kind: "create",
          origin: "animation",
          entityId: 1,
          definitionId: definition.id,
          time: 0,
          transportSequence: 0,
          entryOrder: 0,
          seedHex: reference.seedHex,
        },
      ],
      world: {
        placement: (_event, t) => ({
          resolved: true,
          position: [t * 130, t * 3, t * 70],
          basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        }),
      },
    }),
    start = mismatches.length;
  let retained = null;
  for (const frame of reference.frames) {
    runtime.advanceTo(frame.input.time);
    const before = runtime.checkpoint(),
      draw = runtime.generateDraws(camera(frame)).draws[0];
    assert.deepEqual(
      runtime.checkpoint(),
      before,
      "Camera generation changes simulation state",
    );
    counts.cameraStateChecks++;
    const rawGeometry = Uint8Array.fromHex(frame.output.geometry.verticesHex),
      expected = new DataView(rawGeometry.buffer),
      expectedIndices = new Uint16Array(
        Uint8Array.fromHex(frame.output.geometry.indicesHex).buffer,
      ),
      actual = draw ? directRenderAttributes(draw) : null,
      count = actual?.a_POSITION.length / 3 || 0,
      context = {
        speed: reference.speed,
        seedHex: reference.seedHex,
        time: frame.input.time,
      };
    if (
      count !== rawGeometry.length / 28 ||
      (actual?.index.length ?? 0) !== expectedIndices.length
    )
      mismatches.push({ ...context, kind: "geometry-count" });
    else if (actual) {
      counts.uvHalfwords += compareDirectQuadUv(
        actual,
        rawGeometry,
        context,
        mismatches,
      );
      for (let vertex = 0; vertex < count; vertex++) {
        for (let lane = 0; lane < 3; lane++) {
          const error = Math.abs(
            actual.a_POSITION[vertex * 3 + lane] -
              expected.getFloat32(vertex * 28 + lane * 4, true),
          );
          maxPositionError = Math.max(error, maxPositionError);
          if (!Number.isFinite(error) || error > 0.0001)
            mismatches.push({
              ...context,
              kind: "position",
              vertex,
              lane,
              error,
            });
        }
        for (let lane = 0; lane < 4; lane++) {
          if (
            actual.a_COLOR[vertex * 4 + lane] !==
            rawGeometry[vertex * 28 + 12 + lane]
          )
            mismatches.push({ ...context, kind: "color", vertex, lane });
          counts.colors++;
        }
        counts.vertices++;
      }
      for (const [i, value] of expectedIndices.entries()) {
        if (actual.index[i] !== value)
          mismatches.push({ ...context, kind: "index", i });
        counts.indices++;
      }
    }
    const rng = new DataView(
        Uint8Array.fromHex(frame.output.state.rngHex).buffer,
      ),
      state = before.instances[0]?.[1]?.emitters[0]?.random;
    if (state) {
      const draws = rng.getUint32(8, true),
        expectedState =
          draws === 0
            ? BigInt(`0x${reference.seedHex}`) || 1n
            : rng.getBigUint64(0, true);
      if (
        state.draws !== draws ||
        state.stateHex !== expectedState.toString(16).padStart(16, "0")
      )
        mismatches.push({ ...context, kind: "rng" });
      counts.rngStates++;
    }
    if (!frame.cameraOnly && frame.input.time >= 0.4 && !retained)
      retained = {
        checkpoint: runtime.checkpoint(),
        time: frame.input.time,
        camera: camera(frame),
        draw: structuredClone(draw),
      };
    counts.frames++;
  }
  assert(retained);
  assert.equal(
    runtime.generateDraws(camera(reference.frames.at(-1))).draws.length,
    0,
    "Particle tails did not retire",
  );
  runtime.restore(retained.checkpoint);
  assert.deepEqual(
    runtime.generateDraws(retained.camera).draws[0],
    retained.draw,
  );
  counts.checkpointChecks++;
  runtime.advanceTo(2);
  runtime.advanceTo(retained.time);
  assert.deepEqual(
    runtime.generateDraws(retained.camera).draws[0],
    retained.draw,
  );
  counts.backwardSeekChecks++;
  cases.push({
    speed: reference.speed,
    seedHex: reference.seedHex,
    frames: reference.frames.length,
    mismatches: mismatches.length - start,
  });
}
for (const [path, hash] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), hash, path);
const output = `${cache}/research/direct-nav-camera-schedule-comparison-v37.json`,
  result = {
    schema: 1,
    kind: "direct-camera-navigation-native-schedule-comparison",
    inputs,
    cases,
    counts,
    tolerance: 0.0001,
    maxPositionError,
    mismatches,
    scope: {
      unchangedSourceEmitter: true,
      isolatedSiblingComponents: true,
      originalComponentGeometryAndRng: true,
      supplied60HzClockSeedAndRoot: true,
      cameraOnlyWithoutSimulation: true,
      checkpointAndBackwardSeek: true,
      gpuSubmitted: false,
      actualWorldPlacementCompared: false,
      browserAcceptance: false,
    },
  };
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    ...counts,
    maxPositionError,
    mismatches: mismatches.length,
  }),
);
assert.equal(mismatches.length, 0);
