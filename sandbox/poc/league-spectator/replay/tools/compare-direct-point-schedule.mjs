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
const cameraMode = process.argv.includes("--camera");
const loadedMode = process.argv.includes("--loaded");
const angularMode = process.argv.includes("--angular");
if ([cameraMode, loadedMode, angularMode].filter(Boolean).length > 1)
  throw Error("Choose a single native primitive cohort");
const primitive = cameraMode
  ? "camera"
  : angularMode
    ? "angular"
    : loadedMode
      ? "loaded"
      : "point";
const primitiveProfileKey = cameraMode
  ? "vfxCameraQuadsSha256"
  : loadedMode || angularMode
    ? "vfxLoadedQuadsSha256"
    : "vfxPointQuadsSha256";
const inputs = {};
const bytes = async (path) => {
  const raw = await Bun.file(path).bytes();
  inputs[path] = await sha256(raw);
  return raw;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await bytes(path)));
const load = (path) => bytes(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], bytes);
const native = await read(
  `${cache}/research/direct-${primitive}-schedule-native.json`,
);
const manifestBytes = await load("latest-effects/manifest.json");
if ((await sha256(manifestBytes)) !== native.manifestSha256)
  throw Error("Stale point schedule selection");
for (const [name, expected] of Object.entries(native.sources))
  if ((await sha256(await bytes(resolve(import.meta.dir, name)))) !== expected)
    throw Error(`Native point schedule producer changed: ${name}`);
for (const [path, expected] of Object.entries(native.inputs ?? {}))
  if ((await sha256(await bytes(path))) !== expected)
    throw Error(`Native schedule static input changed: ${path}`);
const admission = await read(`${cache}/research/direct-effects.json`);
const primitiveMetadataBytes = await load(
  `decoder-16.21-macos/vfx-${angularMode ? "loaded" : primitive}-quads.json`,
);
if ((await sha256(primitiveMetadataBytes)) !== native.quadPackageSha256)
  throw Error("Native schedule primitive package changed");
const primitiveMetadata = JSON.parse(
  new TextDecoder().decode(primitiveMetadataBytes),
);
const primitiveIdentities = new Set(
  primitiveMetadata.templates.map((r) => `${r.effectId}:${r.emitterIndex}`),
);
const currentSelection = admission.definitions
  .flatMap((d) => d.supported.map((index) => `${d.id}:${index}`))
  .filter((id) => primitiveIdentities.has(id))
  .filter(
    (id) =>
      !angularMode ||
      native.cases.some((r) => `${r.effectId}:${r.emitterIndex}` === id),
  )
  .sort();
// The angular oracle also observes components with other unsupported behavior;
// compare only the explicitly admitted subset and keep every omission visible.
const omittedNativeCases = angularMode
  ? native.cases.filter(
      (r) => !currentSelection.includes(`${r.effectId}:${r.emitterIndex}`),
    )
  : [];
const selectedNativeCases = angularMode
  ? native.cases.filter((r) =>
      currentSelection.includes(`${r.effectId}:${r.emitterIndex}`),
    )
  : native.cases;
if (!selectedNativeCases.length)
  throw Error("No admitted native schedule component");
const observedSelection = [
  ...new Set(selectedNativeCases.map((r) => `${r.effectId}:${r.emitterIndex}`)),
].sort();
// Native execution depends on the selected original graphs, not compiler source
// bytes. Retain the original admission hash as provenance, while requiring exact
// cohort equality and fresh current admission before testing changed JS code.
if (JSON.stringify(currentSelection) !== JSON.stringify(observedSelection))
  throw Error(
    "Native schedule cohort differs from current admitted components",
  );
const prepared = await loadLatestDirectEffectPackage({
  load,
  manifestBytes,
  effectIds: selectedNativeCases.map((reference) => reference.effectId),
});
for (const reference of selectedNativeCases) {
  const matches = primitiveMetadata.templates.filter(
    (r) =>
      r.effectId === reference.effectId &&
      r.emitterIndex === reference.emitterIndex,
  );
  if (matches.length !== 1 || matches[0].sha256 !== reference.graphSha256)
    throw Error("Native schedule graph identity differs");
}
for (const [file, expected] of Object.entries(admission.inputs.producers))
  if (
    (await sha256(await bytes(resolve(import.meta.dir, "..", file)))) !==
    expected
  )
    throw Error(`Direct point admission producer changed: ${file}`);
if (
  prepared.profile.decoderImageSha256 !== native.decoderImageSha256 ||
  prepared.profile[primitiveProfileKey] !== native.quadPackageSha256
)
  throw Error("Native point schedule image/package differs");
const mismatches = [],
  cases = [],
  comparisons = [],
  visualOmissions = [];
let frames = 0,
  vertices = 0,
  colors = 0,
  halfWords = 0,
  indices = 0,
  streams = 0,
  maxPositionError = 0;
for (const reference of selectedNativeCases) {
  const compiled = prepared.definitions.get(reference.effectId);
  const program = compiled.emitters.find(
    (e) => e.index === reference.emitterIndex,
  );
  if (!program) throw Error("Native schedule component is no longer admitted");
  // Isolate the compiled component, with explicit activation/world inputs. Root
  // dependencies still block real match activation; this control cannot count
  // as whole-definition admission or successful native parent activation.
  const definition = projectDirectEmitterControl(compiled, program);
  const runtime = new LatestDirectEffectRuntime({
    ...prepared.contract,
    replayHash: "0".repeat(64),
    definitions: new Map([[compiled.id, definition]]),
    kernels: prepared.kernels,
    events: [
      {
        id: "schedule-control:0",
        kind: "create",
        origin: "animation",
        entityId: 1,
        definitionId: compiled.id,
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
        basis: reference.frames[
          Math.min(Math.round(t * 60), reference.frames.length - 1)
        ].input.basis.filter((_, lane) => lane < 12 && lane % 4 !== 3),
        boundObjectSize:
          reference.frames[
            Math.min(Math.round(t * 60), reference.frames.length - 1)
          ].input.boundObjectSize,
        boundObjectSizeStatus: "recorded-native-component-control-input",
      }),
    },
  });
  const firstMismatch = mismatches.length;
  let visualScore = -1;
  let visualSamples = [];
  let positiveAreaObserved = false;
  for (const frame of reference.frames) {
    runtime.advanceTo(frame.input.time);
    const beforeCamera = JSON.stringify(runtime.checkpoint());
    const draw = runtime.generateDraws({
      right: frame.input.cameraRight ?? [1, 0, 0],
      up: frame.input.cameraUp ?? [0, 1, 0],
    }).draws[0];
    if (JSON.stringify(runtime.checkpoint()) !== beforeCamera)
      throw Error("Camera geometry changed persistent simulation state");
    const raw = Uint8Array.fromHex(frame.output.geometry.verticesHex);
    const expected = new DataView(raw.buffer);
    const expectedIndices = new Uint16Array(
      Uint8Array.fromHex(frame.output.geometry.indicesHex).buffer,
    );
    // These older unchanged native graphs explicitly have no texture bound.
    // Retain that writer branch in this oracle; complete typed MULT bindings
    // and all six true-texture lanes have their own independent native control.
    const actual = draw
      ? directRenderAttributes(
          program.multUvProgram ? { ...draw, multUV: undefined } : draw,
        )
      : null;
    const score = actual
      ? actual.a_COLOR.reduce(
          (s, n, i) =>
            (program.blend === 0 ? i % 4 !== 3 : i % 4 === 3)
              ? Math.max(s, n)
              : s,
          0,
        )
      : 0;
    // Additive mode0 forces alpha255, so rank its premultiplied RGB instead.
    // A newly born quad can already have maximum alpha while its animated
    // scale is still zero. That frame cannot demonstrate visible geometry.
    // Keep searching later native-compared frames instead of making a zero-
    // extent sample stand in for the entire component's rendering capability.
    let positiveQuadArea = false;
    if (actual) {
      const positions = actual.a_POSITION;
      for (let at = 0; at < positions.length; at += 12) {
        const a = [0, 1, 2].map(
          (lane) => positions[at + 3 + lane] - positions[at + lane],
        );
        const b = [0, 1, 2].map(
          (lane) => positions[at + 9 + lane] - positions[at + lane],
        );
        const cross = [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ];
        if (!cross.every(Number.isFinite))
          throw Error("Visual quad area is nonfinite");
        if (cross.some((value) => value !== 0)) {
          positiveQuadArea = true;
          break;
        }
      }
    }
    positiveAreaObserved ||= positiveQuadArea;
    if (
      ((cameraMode && frame.input.cameraViews === 3) ||
        loadedMode ||
        angularMode) &&
      draw &&
      positiveQuadArea &&
      score > 1 &&
      score >= visualScore
    ) {
      if (score > visualScore) {
        visualScore = score;
        visualSamples = [];
      }
      if (visualSamples.length < (cameraMode ? 3 : 1)) {
        const buffers = directGeometryBuffers(draw);
        visualSamples.push({
          effectId: compiled.id,
          emitterIndex: program.index,
          shaderKey: program.materialKey,
          camera: { right: frame.input.cameraRight, up: frame.input.cameraUp },
          visual: {
            time: frame.input.time,
            geometry: [
              {
                verticesHex: buffers.vertices.toHex(),
                indicesHex: buffers.indices.toHex(),
              },
            ],
          },
        });
      }
    }
    const count = actual?.a_POSITION.length / 3 || 0;
    const context = {
      effectId: compiled.id,
      emitterIndex: program.index,
      time: frame.input.time,
    };
    if (
      count !== raw.byteLength / 28 ||
      (actual?.index.length ?? 0) !== expectedIndices.length
    ) {
      mismatches.push({
        ...context,
        kind: "geometry-count",
        actual: count,
        expected: raw.byteLength / 28,
      });
    } else if (actual) {
      halfWords += compareDirectQuadUv(actual, raw, context, mismatches);
      for (let i = 0; i < count; i++) {
        for (let lane = 0; lane < 3; lane++) {
          const error = Math.abs(
            actual.a_POSITION[i * 3 + lane] -
              expected.getFloat32(i * 28 + lane * 4, true),
          );
          maxPositionError = Math.max(maxPositionError, error);
          if (!Number.isFinite(error) || error > 0.0001)
            mismatches.push({ ...context, kind: "position", i, lane, error });
        }
        for (let lane = 0; lane < 4; lane++) {
          if (actual.a_COLOR[i * 4 + lane] !== raw[i * 28 + 12 + lane])
            mismatches.push({
              ...context,
              kind: "color",
              i,
              lane,
              actual: actual.a_COLOR[i * 4 + lane],
              expected: raw[i * 28 + 12 + lane],
            });
          colors++;
        }
        vertices++;
      }
      for (const [i, value] of expectedIndices.entries()) {
        if (actual.index[i] !== value)
          mismatches.push({ ...context, kind: "index", i });
        indices++;
      }
    }
    const stream = new DataView(
      Uint8Array.fromHex(frame.output.state.rngHex).buffer,
    );
    const state = runtime.checkpoint().instances[0]?.[1]?.emitters[0]?.random;
    if (state) {
      const nativeDraws = stream.getUint32(8, true);
      // The original stream installs the pending supplied seed lazily on its
      // first draw. Our checkpoint stores that effective seed eagerly. Before
      // any draw, compare against the supplied seed and require both counts 0.
      const expectedState =
        nativeDraws === 0
          ? BigInt(`0x${reference.seedHex}`) || 1n
          : stream.getBigUint64(0, true);
      if (
        state.stateHex !== expectedState.toString(16).padStart(16, "0") ||
        state.draws !== nativeDraws
      )
        mismatches.push({ ...context, kind: "rng-state" });
      streams++;
    }
    frames++;
  }
  comparisons.push(...visualSamples);
  if ((cameraMode || loadedMode || angularMode) && !visualSamples.length)
    visualOmissions.push({
      effectId: compiled.id,
      emitterIndex: program.index,
      reason: positiveAreaObserved
        ? "visual:no-positive-vertex-color-and-area-sample-at-selected-camera-ticks"
        : "geometry:no-positive-quad-area-in-native-compared-frames",
    });
  cases.push({
    effectId: compiled.id,
    emitterIndex: program.index,
    frames: reference.frames.length,
    mismatches: mismatches.length - firstMismatch,
  });
}
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
  "latest-direct-effect-birth.mjs",
  "latest-direct-effect-definition.mjs",
  "latest-direct-effect-math.mjs",
  "latest-direct-effect-camera.mjs",
  "latest-direct-effect-camera-table.mjs",
  "latest-direct-effect-draw.mjs",
  "tools/compare-direct-point-schedule.mjs",
  "tools/direct-quad-uv-comparison.mjs",
])
  await bytes(resolve(import.meta.dir, "..", file));
const output = `${cache}/research/direct-${primitive}-schedule-comparison.json`;
const result = {
  schema: 1,
  kind: `direct-${primitive}-native-schedule-comparison`,
  inputs,
  nativeAdmissionSha256: native.admissionSha256,
  omittedNativeComponents: [
    ...new Set(
      omittedNativeCases.map((r) => `${r.effectId}:${r.emitterIndex}`),
    ),
  ],
  cases,
  comparisons,
  visualOmissions,
  counts: { frames, vertices, colors, halfWords, indices, streams },
  maxPositionError,
  mismatches,
  scope: {
    isolatedChildFreeRootProjection: true,
    rootResourceAndChildAdmissionClaimed: false,
    supplied60HzClockAndWorldInputs: true,
    originalParentActivation: false,
    nativeUvBinding: false,
    constantMultiplyGeometryComparedWithOriginalTextureAbsentBranch: true,
    matchCoverage: false,
    browserAcceptance: false,
  },
  visualSamplingPolicy:
    "Maximum observed vertex alpha among native-compared frames with positive quad area; camera samples retain three supplied views at one simulation time",
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
