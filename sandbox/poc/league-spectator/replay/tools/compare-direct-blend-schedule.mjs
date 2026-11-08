import { resolve } from "node:path";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { LatestDirectEffectRuntime } from "../latest-direct-effect-runtime.mjs";
import {
  directRenderAttributes,
  directGeometryBuffers,
} from "../latest-direct-effect-draw.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { compareDirectQuadUv } from "./direct-quad-uv-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { projectDirectEmitterControl } from "./direct-emitter-control-projection.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
// Keep the original default-blend emitters intact. Root/world dependencies are
// explicitly isolated for this component oracle, and each shader binding key
// remains that of the unchanged authored effect definition.
const motionMode = true;
const cohort = "blend";
const inputs = {};
const bytes = async (path) => {
  const raw = await Bun.file(path).bytes();
  const digest = await sha256(raw);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Position comparison input changed during execution: ${path}`);
  inputs[path] = digest;
  return raw;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await bytes(path)));
const load = (path) => bytes(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], bytes);
const native = await read(
  `${cache}/research/direct-${cohort}-schedule-native.json`,
);
for (const [name, expected] of Object.entries(native.sources))
  if ((await sha256(await bytes(resolve(import.meta.dir, name)))) !== expected)
    throw Error(`Native position producer changed: ${name}`);
for (const [path, expected] of Object.entries(native.inputs))
  if ((await sha256(await bytes(path))) !== expected)
    throw Error(`Native position static input changed: ${path}`);
const admission = await read(`${cache}/research/direct-effects.json`);
for (const [file, expected] of Object.entries(admission.inputs.producers))
  if (
    (await sha256(await bytes(resolve(import.meta.dir, "..", file)))) !==
    expected
  )
    throw Error(`Position admission producer changed: ${file}`);
const manifestBytes = await load("latest-effects/manifest.json");
if ((await sha256(manifestBytes)) !== native.manifestSha256)
  throw Error("Position native manifest changed");
const prepared = await loadLatestDirectEffectPackage({
  load,
  manifestBytes,
  effectIds: [...new Set(native.cases.map((c) => c.effectId))],
});
const current = [...prepared.definitions.values()]
  .flatMap((d) =>
    d.emitters
      .filter((e) =>
        motionMode
          ? native.cases.some(
              (c) => c.effectId === d.id && c.emitterIndex === e.index,
            )
          : e.emitterPosition,
      )
      .map((e) => `${d.id}:${e.index}`),
  )
  .sort();
const selectedNativeCases = motionMode
  ? native.cases.filter((c) =>
      prepared.definitions
        .get(c.effectId)
        .emitters.some((e) => e.index === c.emitterIndex),
    )
  : native.cases;
const omittedNativeCases = native.cases.filter(
  (c) => !selectedNativeCases.includes(c),
);
const observed = [
  ...new Set(selectedNativeCases.map((c) => `${c.effectId}:${c.emitterIndex}`)),
].sort();
if (JSON.stringify(current) !== JSON.stringify(observed))
  throw Error("Native position selection differs from compiled components");
for (const [kind, expected] of Object.entries(native.packages)) {
  const metadata = await read(
    `${cache}/public/decoder-16.21-macos/vfx-${kind}-quads.json`,
  );
  if (
    inputs[`${cache}/public/decoder-16.21-macos/vfx-${kind}-quads.json`] !==
    expected
  )
    throw Error("Native position primitive package changed");
  for (const c of native.cases.filter((c) => c.primitiveKind === kind)) {
    const matches = metadata.templates.filter(
      (r) => r.effectId === c.effectId && r.emitterIndex === c.emitterIndex,
    );
    if (matches.length !== 1 || matches[0].sha256 !== c.graphSha256)
      throw Error("Native position component graph differs");
  }
}
const mismatches = [],
  cases = [],
  comparisons = [],
  motionSequences = [],
  visualOmissions = [];
const capturedComponents = new Set();
const motionTicks = new Set([0, 6, 12, 18, 24, 30, 45, 60, 90, 120]);
for (const file of [
  "latest-direct-effect-runtime.mjs",
  "latest-direct-effect-audio.mjs",
  "latest-direct-effect-position.mjs",
  "latest-direct-effect-world-inputs.mjs",
  "latest-direct-effect-flex.mjs",
  "latest-direct-effect-orientation.mjs",
  "latest-direct-effect-integrated-rotation.mjs",
  "latest-direct-effect-soft.mjs",
  "latest-direct-effect-sprite.mjs",
  "latest-direct-particle-palette.mjs",
  "latest-direct-effect-definition.mjs",
  "latest-direct-effect-birth.mjs",
  "latest-direct-effect-math.mjs",
  "latest-direct-effect-draw.mjs",
  "latest-direct-effect-camera.mjs",
  "latest-direct-effect-camera-table.mjs",
  "tools/compare-direct-blend-schedule.mjs",
  "tools/direct-quad-uv-comparison.mjs",
])
  await bytes(resolve(import.meta.dir, "..", file));
let frames = 0,
  vertices = 0,
  colors = 0,
  halfWords = 0,
  indices = 0,
  streams = 0,
  maxPositionError = 0;
for (const reference of selectedNativeCases) {
  const d = prepared.definitions.get(reference.effectId);
  const program = d.emitters.find((e) => e.index === reference.emitterIndex);
  // World/parent dependencies are isolated explicitly for this kernel control.
  const definition = projectDirectEmitterControl(d, program);
  const runtime = new LatestDirectEffectRuntime({
    ...prepared.contract,
    replayHash: "0".repeat(64),
    definitions: new Map([[d.id, definition]]),
    kernels: prepared.kernels,
    events: [
      {
        id: "position-control:0",
        kind: "create",
        origin: "animation",
        entityId: 1,
        definitionId: d.id,
        time: 0,
        transportSequence: 0,
        entryOrder: 0,
        seedHex: reference.seedHex,
      },
    ],
    world: {
      placement: (_e, t) => ({
        resolved: true,
        boundObjectSize: 0,
        boundObjectSizeStatus: "supplied-native-component-control-zero",
        position: [t * 130, t * 3, t * 70],
        basis: reference.frames[
          Math.min(Math.round(t * 60), reference.frames.length - 1)
        ].input.basis.filter((_, i) => i < 12 && i % 4 !== 3),
      }),
    },
  });
  const start = mismatches.length;
  const componentKey = `${d.id}:${program.index}`;
  const captureMotion = motionMode && !capturedComponents.has(componentKey);
  const motionFrames = [];
  let visual = null,
    visualScore = -1;
  if (captureMotion) capturedComponents.add(componentKey);
  for (const frame of reference.frames) {
    runtime.advanceTo(frame.input.time);
    const checkpoint = JSON.stringify(runtime.checkpoint());
    const draw = runtime.generateDraws({
      right: frame.input.cameraRight,
      up: frame.input.cameraUp,
    }).draws[0];
    if (JSON.stringify(runtime.checkpoint()) !== checkpoint)
      throw Error("Position camera generation changed retained simulation");
    const raw = Uint8Array.fromHex(frame.output.geometry.verticesHex);
    const expected = new DataView(raw.buffer);
    const expectedIndices = new Uint16Array(
      Uint8Array.fromHex(frame.output.geometry.indicesHex).buffer,
    );
    const actual = draw ? directRenderAttributes(draw) : null;
    if (captureMotion) {
      const buffers = draw ? directGeometryBuffers(draw) : null;
      const geometry = {
        verticesHex: buffers?.vertices.toHex() ?? "",
        indicesHex: buffers?.indices.toHex() ?? "",
      };
      if (motionTicks.has(Math.round(frame.input.time * 60)))
        motionFrames.push({ time: frame.input.time, geometry });
      const score = actual
        ? actual.a_COLOR.reduce(
            (highest, value, index) =>
              // Native additive mode0 forces packed alpha255, including black
              // frames. Choose positive premultiplied RGB for the visual sample.
              index % 4 !== 3 ? Math.max(highest, value) : highest,
            0,
          )
        : 0;
      let positiveArea = false;
      if (actual)
        for (let at = 0; at < actual.a_POSITION.length; at += 12) {
          const a = [0, 1, 2].map(
            (lane) =>
              actual.a_POSITION[at + 3 + lane] - actual.a_POSITION[at + lane],
          );
          const b = [0, 1, 2].map(
            (lane) =>
              actual.a_POSITION[at + 9 + lane] - actual.a_POSITION[at + lane],
          );
          const cross = [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
          ];
          if (!cross.every(Number.isFinite))
            throw Error("Motion visual area is nonfinite");
          positiveArea ||= cross.some((value) => value !== 0);
        }
      if (positiveArea && score > 1 && score > visualScore) {
        visualScore = score;
        visual = { time: frame.input.time, geometry: [geometry] };
      }
    }
    const count = actual?.a_POSITION.length / 3 || 0;
    const context = {
      effectId: d.id,
      emitterIndex: program.index,
      seedHex: reference.seedHex,
      pose: reference.pose,
      time: frame.input.time,
    };
    if (
      count !== raw.byteLength / 28 ||
      (actual?.index.length ?? 0) !== expectedIndices.length
    )
      mismatches.push({
        ...context,
        kind: "geometry-count",
        actual: count,
        expected: raw.byteLength / 28,
      });
    else if (actual) {
      halfWords += compareDirectQuadUv(actual, raw, context, mismatches);
      for (let i = 0; i < count; i++) {
        for (let lane = 0; lane < 3; lane++) {
          const error = Math.abs(
            actual.a_POSITION[i * 3 + lane] -
              expected.getFloat32(i * 28 + lane * 4, true),
          );
          maxPositionError = Math.max(maxPositionError, error);
          if (!Number.isFinite(error) || error > 0.0001)
            mismatches.push({
              ...context,
              kind: "position",
              i,
              lane,
              error,
              actual: actual.a_POSITION[i * 3 + lane],
              expected: expected.getFloat32(i * 28 + lane * 4, true),
            });
        }
        for (let lane = 0; lane < 4; lane++) {
          if (actual.a_COLOR[i * 4 + lane] !== raw[i * 28 + 12 + lane])
            mismatches.push({ ...context, kind: "color", i, lane });
          colors++;
        }
        vertices++;
      }
      for (const [i, v] of expectedIndices.entries()) {
        if (actual.index[i] !== v)
          mismatches.push({ ...context, kind: "index", i });
        indices++;
      }
    }
    const rng = new DataView(
      Uint8Array.fromHex(frame.output.state.rngHex).buffer,
    );
    const state = runtime.checkpoint().instances[0]?.[1]?.emitters[0]?.random;
    if (state) {
      const draws = rng.getUint32(8, true);
      const expectedState =
        draws === 0
          ? BigInt(`0x${reference.seedHex}`) || 1n
          : rng.getBigUint64(0, true);
      if (
        state.draws !== draws ||
        state.stateHex !== expectedState.toString(16).padStart(16, "0")
      )
        mismatches.push({ ...context, kind: "rng-state" });
      streams++;
    }
    frames++;
  }
  if (captureMotion) {
    const identity = {
      effectId: d.id,
      emitterIndex: program.index,
      shaderKey: program.materialKey,
      primitiveKind: reference.primitiveKind,
      pose: reference.pose,
      seedHex: reference.seedHex,
      camera: {
        right: reference.frames[0].input.cameraRight,
        up: reference.frames[0].input.cameraUp,
      },
    };
    motionSequences.push({ ...identity, frames: motionFrames });
    if (visual) comparisons.push({ ...identity, visual });
    else
      visualOmissions.push({
        ...identity,
        reason:
          "visual:no-positive-premultiplied-rgb-and-area-native-compared-frame",
      });
  }
  cases.push({
    effectId: d.id,
    emitterIndex: program.index,
    primitiveKind: reference.primitiveKind,
    pose: reference.pose,
    seedHex: reference.seedHex,
    frames: reference.frames.length,
    mismatches: mismatches.length - start,
  });
}
for (const path of Object.keys(inputs)) await bytes(path);
const output = `${cache}/research/direct-${cohort}-schedule-comparison.json`;
const result = {
  schema: 1,
  kind: `direct-${cohort}-native-schedule-comparison`,
  omittedNativeComponents: [
    ...new Set(
      omittedNativeCases.map((c) => `${c.effectId}:${c.emitterIndex}`),
    ),
  ],
  inputs,
  cases,
  comparisons,
  motionSequences,
  visualOmissions,
  visualSamplingPolicy: motionMode
    ? "First native case per component, ten fixed simulation times and a positive-area sample maximizing its native-compared premultiplied RGB byte; supplied moving root, pose and seed"
    : null,
  counts: {
    components: observed.length,
    frames,
    vertices,
    colors,
    halfWords,
    indices,
    streams,
  },
  maxPositionError,
  mismatches,
  scope: {
    isolatedChildFreeRootProjection: true,
    rootResourceAndChildAdmissionClaimed: false,
    unchangedNativeComponents: true,
    suppliedClockSeedMotionAndPose: true,
    nativeParentActivation: false,
    gpuSubmitted: false,
    matchCoverage: false,
    browserAcceptance: false,
  },
};
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    {
      output,
      counts: result.counts,
      maxPositionError,
      mismatchCount: mismatches.length,
      examples: mismatches.slice(0, 8),
    },
    null,
    2,
  ),
);
if (mismatches.length) process.exitCode = 1;
