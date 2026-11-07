// Full packed native quad UVs, plus retained-state/control boundaries. This is
// an isolated supplied-world kernel comparison, not ordinary-match activation.
import { resolve } from "node:path";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { LatestDirectEffectRuntime } from "../latest-direct-effect-runtime.mjs";
import {
  directRenderAttributes,
  directGeometryBuffers,
} from "../latest-direct-effect-draw.mjs";
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
  load = (path) => raw(`${cache}/public/${path}`),
  exact = (a, b) => JSON.stringify(a) === JSON.stringify(b);
await captureDirectSourceInputs([import.meta.path], raw);
const cohorts = [];
for (const name of ["quad-sprite", "particle-palette"]) {
  const proof = await read(`${cache}/research/direct-${name}-comparison.json`);
  if (
    !proof.inputs ||
    Object.keys(proof.inputs).length === 0 ||
    proof.differences?.length ||
    proof.mismatches?.length
  )
    throw Error("Passing strict original control comparison required");
  if (
    name === "quad-sprite"
      ? proof.kind !== "verified-native-four-frame-random-start-quads" ||
        proof.counts?.nativeFrames !== 496 ||
        proof.counts?.scalarCases !== 18 ||
        proof.exactFrameFloat32AndHalf !== true ||
        proof.retainedStateAndRngUnchangedExceptDeclaredFrame !== true
      : proof.kind !==
          "default-native-particle-palette-coordinate-comparison" ||
        proof.frames !== 488 ||
        proof.controllerInputs !== 128 ||
        proof.arithmeticAndHalfControls !== 67 ||
        !Array.isArray(proof.differences)
  )
    throw Error(
      "Complete passing typed controller and packing proofs required",
    );
  for (const [path, hash] of Object.entries(proof.inputs))
    if ((await sha256(await raw(path))) !== hash)
      throw Error(`Stale control proof: ${path}`);
  const nativePath = resolve(cache, `research/direct-${name}-native.json`),
    native = await read(nativePath);
  if (proof.inputs[nativePath] !== inputs[nativePath])
    throw Error(
      "Native matrix must be the exact input of its strict comparison",
    );
  if (
    !Array.isArray(native.cases) ||
    native.cases.length !== 16 ||
    native.cases.reduce((n, c) => n + c.frames.length, 0) !==
      (name === "quad-sprite" ? 496 : 976)
  )
    throw Error("Complete nonempty native control matrices required");
  cohorts.push({ name, native });
}
const references = cohorts.flatMap(({ name, native }) =>
    native.cases
      .filter((c) => c.variant === "authored")
      .map((c) => ({ ...c, cohort: name })),
  ),
  manifestBytes = await load("latest-effects/manifest.json"),
  prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes,
    effectIds: [...new Set(references.map((c) => c.effectId))],
  });
const mismatches = [],
  cases = [],
  omittedNativeComponents = [],
  comparisons = [],
  motionSequences = [],
  seen = new Set();
const counts = {
    components: 0,
    frames: 0,
    vertices: 0,
    colors: 0,
    indices: 0,
    halfWords: 0,
    streams: 0,
    particleStates: 0,
    births: 0,
  },
  controls = {
    pausedDraws: 0,
    cameraOnlyDraws: 0,
    backwardRepeatedSeeks: 0,
    checkpointRestores: 0,
  };
let maxPositionError = 0;
const reject = (context, kind, detail = {}) =>
  mismatches.push({ ...context, kind, ...detail });
for (const reference of references) {
  const definition = prepared.definitions.get(reference.effectId),
    program = definition?.emitters.find(
      (e) => e.index === reference.emitterIndex,
    );
  if (!program) {
    omittedNativeComponents.push({
      effectId: reference.effectId,
      emitterIndex: reference.emitterIndex,
      seedHex: reference.seedHex,
      frames: reference.frames.length,
      reasons: definition?.unsupported.filter(
        (e) => e.index === reference.emitterIndex,
      ) ?? ["definition-unprepared"],
    });
    continue;
  }
  const identity = `${definition.id}:${program.index}`,
    first = !seen.has(identity);
  seen.add(identity);
  const runtime = new LatestDirectEffectRuntime({
    ...prepared.contract,
    replayHash: "0".repeat(64),
    definitions: new Map([
      [
        definition.id,
        { ...definition, blockers: [], unsupported: [], emitters: [program] },
      ],
    ]),
    kernels: prepared.kernels,
    events: [
      {
        id: "quad-uv-control:0",
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
      placement: (_event, time) => {
        const input =
          reference.frames[
            Math.min(Math.round(time * 60), reference.frames.length - 1)
          ].input;
        return {
          resolved: true,
          position: [time * 130, time * 3, time * 70],
          basis: input.basis.filter((_, i) => i < 12 && i % 4 !== 3),
          boundObjectSize: input.boundObjectSize ?? 1,
          boundObjectSizeStatus:
            "supplied-native-quad-UV-control-original-default-one",
        };
      },
    },
  });
  let lastRandom = null,
    visual = null,
    visualScore = -1;
  let previousBirths = new Map();
  const start = mismatches.length,
    captured = [],
    checkpoints = new Map(),
    drawsAt = new Map();
  for (let tick = 0; tick < reference.frames.length; tick++) {
    const frame = reference.frames[tick],
      time = frame.input.time,
      context = {
        effectId: definition.id,
        emitterIndex: program.index,
        cohort: reference.cohort,
        seedHex: reference.seedHex,
        pose: reference.pose ?? "identity",
        time,
      };
    if (time !== tick / 60)
      throw Error("Exact original 60Hz native clocks required");
    runtime.advanceTo(time);
    const state = runtime.checkpoint(),
      snapshot = JSON.stringify(state),
      camera = { right: frame.input.cameraRight, up: frame.input.cameraUp },
      packet = runtime.generateDraws(camera),
      draw = packet.draws[0],
      actual = draw ? directRenderAttributes(draw) : null,
      rawVertices = Uint8Array.fromHex(frame.output.geometry.verticesHex),
      expected = new DataView(rawVertices.buffer),
      expectedIndices = new Uint16Array(
        Uint8Array.fromHex(frame.output.geometry.indicesHex).buffer,
      ),
      emitter = state.instances[0]?.[1].emitters[0],
      expectedCount = frame.output.state.vectors.life.count,
      count = actual ? actual.a_POSITION.length / 3 : 0;
    if (snapshot !== JSON.stringify(runtime.checkpoint()))
      throw Error("Native UV draw advanced simulation/RNG");
    if ((emitter?.count ?? 0) !== expectedCount)
      reject(context, "retained-particle-count", {
        actual: emitter?.count ?? 0,
        expected: expectedCount,
      });
    const currentBirths = new Map(),
      nativeLife = new DataView(
        Uint8Array.fromHex(frame.output.state.vectors.life.hex).buffer,
      ),
      nativeMotion = new DataView(
        Uint8Array.fromHex(frame.output.state.vectors.motion.hex).buffer,
      );
    for (let particle = 0; particle < (emitter?.count ?? 0); particle++) {
      const at = particle * 20,
        signature = JSON.stringify([
          emitter.data[at],
          emitter.data[at + 1],
          emitter.data[at + 18],
        ]);
      currentBirths.set(signature, (currentBirths.get(signature) ?? 0) + 1);
      if (
        particle < expectedCount &&
        (emitter.data[at] !== nativeLife.getFloat32(particle * 8, true) ||
          emitter.data[at + 1] !==
            nativeLife.getFloat32(particle * 8 + 4, true) ||
          emitter.data[at + 18] !==
            nativeMotion.getFloat32(particle * 36 + 32, true))
      )
        reject(context, "retained-birth-clock-lifetime-or-chance", {
          particle,
        });
      counts.particleStates++;
    }
    const born = [...currentBirths].reduce(
      (sum, [signature, count]) =>
        sum + Math.max(0, count - (previousBirths.get(signature) ?? 0)),
      0,
    );
    previousBirths = currentBirths;
    if (born !== frame.output.state.births.length)
      reject(context, "birth-count", {
        actual: born,
        expected: frame.output.state.births.length,
      });
    counts.births += frame.output.state.births.length;
    if (
      count !== rawVertices.length / 28 ||
      (actual?.index.length ?? 0) !== expectedIndices.length
    )
      reject(context, "geometry-count");
    else if (actual) {
      for (let vertex = 0; vertex < count; vertex++) {
        for (let lane = 0; lane < 3; lane++) {
          const error = Math.abs(
            actual.a_POSITION[vertex * 3 + lane] -
              expected.getFloat32(vertex * 28 + lane * 4, true),
          );
          maxPositionError = Math.max(maxPositionError, error);
          if (!Number.isFinite(error) || error > 0.0001)
            reject(context, "position", { vertex, lane, error });
        }
        for (let lane = 0; lane < 4; lane++) {
          if (
            actual.a_COLOR[vertex * 4 + lane] !==
            rawVertices[vertex * 28 + 12 + lane]
          )
            reject(context, "packed-color", { vertex, lane });
          if (
            actual.a_TEXCOORD[vertex * 4 + lane] !==
            expected.getUint16(vertex * 28 + 16 + lane * 2, true)
          )
            reject(context, "packed-uv", { vertex, lane });
          counts.colors++;
          counts.halfWords++;
        }
        for (let lane = 0; lane < 2; lane++) {
          const observed = actual.a_TEXCOORD1[vertex * 2 + lane],
            wanted = expected.getUint16(vertex * 28 + 24 + lane * 2, true);
          if (observed !== wanted)
            reject(context, "packed-palette-uv", {
              vertex,
              lane,
              actual: observed,
              expected: wanted,
            });
          counts.halfWords++;
        }
        counts.vertices++;
      }
      for (let i = 0; i < expectedIndices.length; i++) {
        if (actual.index[i] !== expectedIndices[i])
          reject(context, "index", { i });
        counts.indices++;
      }
    }
    const rng = new DataView(
        Uint8Array.fromHex(frame.output.state.rngHex).buffer,
      ),
      draws = rng.getUint32(8, true),
      expectedState =
        draws === 0
          ? BigInt(`0x${reference.seedHex}`) || 1n
          : rng.getBigUint64(0, true);
    if (emitter) lastRandom = emitter.random;
    if (
      lastRandom &&
      (lastRandom.draws !== draws ||
        lastRandom.stateHex !== expectedState.toString(16).padStart(16, "0"))
    )
      reject(context, "rng-state");
    if (!lastRandom && draws !== 0) reject(context, "missing-rng-state");
    counts.streams++;
    const geometry = draw
        ? directGeometryBuffers(draw)
        : { vertices: new Uint8Array(), indices: new Uint8Array() },
      encoded = {
        verticesHex: geometry.vertices.toHex(),
        indicesHex: geometry.indices.toHex(),
      };
    drawsAt.set(tick, encoded);
    if (tick === 6 || tick === reference.frames.length - 1)
      checkpoints.set(tick, state);
    if (first && [0, 1, 6, 12, 18, 24, 30, 45, 60].includes(tick))
      captured.push({ time, geometry: encoded });
    const score = actual
      ? actual.a_COLOR.reduce(
          (highest, value, i) =>
            (program.blend === 0 ? i % 4 !== 3 : i % 4 === 3)
              ? Math.max(highest, value)
              : highest,
          0,
        )
      : 0;
    let positive = false;
    if (actual)
      for (let at = 0; at < actual.a_POSITION.length; at += 12) {
        const a = [0, 1, 2].map(
            (lane) =>
              actual.a_POSITION[at + 3 + lane] - actual.a_POSITION[at + lane],
          ),
          b = [0, 1, 2].map(
            (lane) =>
              actual.a_POSITION[at + 9 + lane] - actual.a_POSITION[at + lane],
          );
        positive ||=
          Math.hypot(
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
          ) > 0;
      }
    if (first && positive && score > 1 && score > visualScore) {
      visualScore = score;
      visual = { time, geometry: [encoded] };
    }
    if (tick === 6) {
      const repeat = runtime.generateDraws(camera).draws[0],
        repeatGeometry = repeat
          ? directGeometryBuffers(repeat)
          : { vertices: new Uint8Array(), indices: new Uint8Array() };
      if (
        !exact(encoded, {
          verticesHex: repeatGeometry.vertices.toHex(),
          indicesHex: repeatGeometry.indices.toHex(),
        })
      )
        throw Error("Paused quad UV draw changed geometry");
      controls.pausedDraws++;
      runtime.generateDraws({ right: [0, 0, -1], up: [0, 1, 0] });
      if (snapshot !== JSON.stringify(runtime.checkpoint()))
        throw Error("Camera-only UV redraw changed retained state");
      controls.cameraOnlyDraws++;
    }
    counts.frames++;
  }
  const finalTick = reference.frames.length - 1,
    finalState = JSON.stringify(runtime.checkpoint()),
    finalCamera = {
      right: reference.frames[finalTick].input.cameraRight,
      up: reference.frames[finalTick].input.cameraUp,
    };
  runtime.advanceTo(6 / 60);
  const rewind = runtime.generateDraws({
      right: reference.frames[6].input.cameraRight,
      up: reference.frames[6].input.cameraUp,
    }).draws[0],
    rewindGeometry = rewind
      ? directGeometryBuffers(rewind)
      : { vertices: new Uint8Array(), indices: new Uint8Array() };
  if (
    !exact(drawsAt.get(6), {
      verticesHex: rewindGeometry.vertices.toHex(),
      indicesHex: rewindGeometry.indices.toHex(),
    })
  )
    throw Error("Backward seek changed packed quad UVs");
  runtime.advanceTo(finalTick / 60);
  if (finalState !== JSON.stringify(runtime.checkpoint()))
    throw Error("Repeated forward seek changed retained quad state");
  controls.backwardRepeatedSeeks++;
  runtime.restore(checkpoints.get(6));
  runtime.advanceTo(finalTick / 60);
  if (finalState !== JSON.stringify(runtime.checkpoint()))
    throw Error("Explicit UV checkpoint restore changed RNG/state");
  runtime.generateDraws(finalCamera);
  controls.checkpointRestores++;
  if (first) {
    const identity = {
      effectId: definition.id,
      emitterIndex: program.index,
      shaderKey: program.materialKey,
      primitiveKind: reference.primitiveKind,
      seedHex: reference.seedHex,
      camera: {
        right: reference.frames[0].input.cameraRight,
        up: reference.frames[0].input.cameraUp,
      },
    };
    motionSequences.push({ ...identity, frames: captured });
    if (!visual)
      throw Error(
        "Every newly admitted UV component requires colored positive native-compared geometry",
      );
    comparisons.push({ ...identity, visual });
  }
  cases.push({
    effectId: definition.id,
    emitterIndex: program.index,
    primitiveKind: reference.primitiveKind,
    seedHex: reference.seedHex,
    pose: reference.pose ?? "identity",
    frames: reference.frames.length,
    mismatches: mismatches.length - start,
  });
}
counts.components = seen.size;
if (
  counts.components !== 6 ||
  counts.frames !== 736 ||
  omittedNativeComponents.length !== 0
)
  throw Error(
    "All six authored UV components, including explicit-zero Jinx, must pass native comparison",
  );
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Final UV input drift: ${path}`);
const output = `${cache}/research/direct-quad-uv-schedule-comparison.json`,
  result = {
    schema: 1,
    kind: "direct-quad-uv-native-schedule-comparison",
    inputs,
    cases,
    comparisons,
    motionSequences,
    counts,
    controls,
    nativeControlMatrix: {
      cases: 32,
      frames: 1472,
      authoredFrames: 736,
      compiledComparedFrames: 736,
      explicitlyUncompiledFrames: 0,
    },
    omittedNativeComponents,
    maxPositionError,
    mismatches,
    scope: {
      suppliedClockSeedMotionAndBasis: true,
      fullSixPackedHalfLanesCompared: true,
      allNativeStateBytesCompared: false,
      nativeBirthCountsLivenessAndRngCompared: true,
      nativeParentActivation: false,
      gpuSubmitted: false,
      matchCoverage: false,
      browserAcceptance: false,
    },
  };
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    counts,
    controls,
    maxPositionError,
    mismatches: mismatches.length,
    examples: mismatches.slice(0, 8),
  }),
);
if (mismatches.length) process.exitCode = 1;
