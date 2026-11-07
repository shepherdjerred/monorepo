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
const motionMode = process.argv.includes("--motion");
const zeroMode = process.argv.includes("--zero-position");
const orientationMode = process.argv.includes("--particle-orientation");
const rotationMode = process.argv.includes("--integrated-rotation");
const softMode = process.argv.includes("--soft-particles");
if (
  [motionMode, zeroMode, orientationMode, rotationMode, softMode].filter(
    Boolean,
  ).length > 1
)
  throw Error("Select one position comparison cohort");
const cohort = softMode
  ? "soft-particles"
  : rotationMode
    ? "integrated-rotation"
    : orientationMode
      ? "particle-orientation"
      : zeroMode
        ? "zero-position"
        : motionMode
          ? "motion"
          : "position";
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
  `${cache}/research/direct-${cohort}${softMode || rotationMode ? "" : orientationMode ? "-bounded" : zeroMode ? "" : "-schedule"}-native.json`,
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
if (
  !zeroMode &&
  !orientationMode &&
  !rotationMode &&
  !softMode &&
  (await sha256(manifestBytes)) !== native.manifestSha256
)
  throw Error("Position native manifest changed");
let nativeVariantEquivalence = null;
if (softMode) {
  const proof = await read(
    `${cache}/research/direct-soft-particles-comparison.json`,
  );
  if (
    proof.kind !== "soft-particle-depth-disabled-partial-proof" ||
    proof.counts?.comparedAuthoredFrames !== 484 ||
    proof.counts?.comparedNativeFramesIncludingAbsent !== 968 ||
    proof.nativeGeometryRngAndCompleteRetainedStateExact !== true ||
    proof.scope.depthIntersectionImplemented !== false ||
    proof.visual?.visiblePixels < 100
  )
    throw Error("Complete native depth-disabled soft-particle proof required");
  for (const [path, expected] of Object.entries(proof.inputs))
    if ((await sha256(await bytes(path))) !== expected)
      throw Error(`Native soft-particle proof changed: ${path}`);
  nativeVariantEquivalence = {
    completeNativeStateGeometryAndRngExact: true,
    nativeFrames: 968,
    depthIntersectionImplemented: false,
    actualGraphicsSettingRecovered: false,
  };
}
if (rotationMode) {
  const proof = await read(
    `${cache}/research/direct-integrated-rotation-comparison.json`,
  );
  if (
    proof.kind !== "verified-flat-integrated-vector3-rotation" ||
    proof.frames !== 488 ||
    proof.tableScalars !== 960 ||
    proof.queries !== 60 ||
    proof.arithmetic !== 180 ||
    proof.exactMath !== true ||
    proof.exactAuthoredCameraGeometry !== true
  )
    throw Error(
      "Complete original integrated-rotation math and emitter comparison required",
    );
  for (const [path, expected] of Object.entries(proof.inputs))
    if ((await sha256(await bytes(path))) !== expected)
      throw Error(`Native rotation proof changed: ${path}`);
  nativeVariantEquivalence = {
    exactMath: true,
    exactAuthoredCameraGeometry: true,
    frames: proof.frames,
  };
}
if (orientationMode) {
  const proof = await read(
    `${cache}/research/direct-particle-orientation-comparison.json`,
  );
  if (
    proof.kind !== "verified-bounded-camera-particle-orientation-controls" ||
    proof.cases !== 24 ||
    proof.frames !== 1464 ||
    proof.exactGeometry !== true ||
    proof.scope.nativeMissileBasisRecovered !== false
  )
    throw Error("Complete bounded native orientation comparison required");
  for (const [path, expected] of Object.entries(proof.inputs))
    if ((await sha256(await bytes(path))) !== expected)
      throw Error(`Native orientation proof changed: ${path}`);
  nativeVariantEquivalence = {
    exactGeometry: true,
    nativeOrientationStreamOmission: proof.nativeOrientationStreamOmission,
    cases: proof.cases,
    frames: proof.frames,
  };
}
if (zeroMode) {
  const profile = await read(
    `${cache}/public/decoder-16.21-macos/profile.json`,
  );
  const inventoryBytes = await bytes(
    `${cache}/public/decoder-16.21-macos/vfx-assets.json`,
  );
  const inventory = JSON.parse(new TextDecoder().decode(inventoryBytes));
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  const image = await bytes(`${cache}/public/decoder-16.21-macos/image.bin`);
  if (
    native.kind !== "native-singleton-zero-emitter-position-controls" ||
    native.build !== profile.clientVersion ||
    native.protocol !== profile.protocolDigest ||
    native.decoderImageSha256 !== profile.decoderImageSha256 ||
    (await sha256(image)) !== profile.decoderImageSha256 ||
    (await sha256(inventoryBytes)) !== profile.vfxAssetsSha256 ||
    inventory.effectsManifestSha256 !== (await sha256(manifestBytes))
  )
    throw Error(
      "Exact zero-position native inventory/manifest/image provenance required",
    );
  if (
    !Array.isArray(native.selected) ||
    !native.selected.length ||
    !Array.isArray(native.cases)
  )
    throw Error("Nonempty selected zero-position component matrix required");
  const components = new Set(),
    expectedCases = new Set();
  for (const c of native.selected) {
    const key = JSON.stringify([c.effectId, c.emitterIndex]);
    if (components.has(key))
      throw Error("Duplicate selected zero-position component");
    components.add(key);
    for (const seed of ["0000000000000001", "0000000000012345"])
      for (const pose of ["identity", "yaw90", "pitch90", "changing"])
        for (const variant of ["authored", "constant-zero", "absent"])
          expectedCases.add(
            JSON.stringify([c.effectId, c.emitterIndex, seed, pose, variant]),
          );
  }
  const observedCases = new Set();
  for (const c of native.cases) {
    const key = JSON.stringify([
      c.effectId,
      c.emitterIndex,
      c.seedHex,
      c.pose,
      c.variant,
    ]);
    if (!expectedCases.has(key) || observedCases.has(key))
      throw Error("Unknown or duplicate zero-position equivalence case");
    observedCases.add(key);
    if (
      !Array.isArray(c.frames) ||
      c.frames.length !== 61 ||
      c.frames.some((frame, tick) => frame.input.time !== tick / 60)
    )
      throw Error("Complete zero-position 61-frame clock sequence required");
  }
  if (observedCases.size !== expectedCases.size)
    throw Error(
      "Missing zero-position authored/default/constant equivalence case",
    );
  for (const component of native.selected)
    if (
      inventory.emitters[`${component.effectId}:${component.emitterIndex}`]
        ?.definitionSha256 !== manifest.definitions[component.effectId]?.sha256
    )
      throw Error(
        "Zero-position original field spans differ from prepared definition",
      );
  for (const block of native.originalBlocks)
    if (
      (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
      block.sha256
    )
      throw Error("Zero-position original instruction bytes changed");
  for (const c of native.cases) {
    const authored = native.cases.find(
      (a) =>
        a.effectId === c.effectId &&
        a.emitterIndex === c.emitterIndex &&
        a.seedHex === c.seedHex &&
        a.pose === c.pose &&
        a.variant === "authored",
    );
    if (
      !authored ||
      c.differentFrames.length ||
      c.frames.length !== 61 ||
      JSON.stringify(c.frames) !== JSON.stringify(authored.frames) ||
      !c.frames.some((f) => f.output.state.births.length)
    )
      throw Error(
        "Position authored/default/constant birth, clock, RNG or geometry differs",
      );
    let observable = false;
    for (const frame of c.frames) {
      const raw = Uint8Array.fromHex(frame.output.geometry.verticesHex);
      const values = new DataView(raw.buffer);
      const indices = new Uint16Array(
        Uint8Array.fromHex(frame.output.geometry.indicesHex).buffer,
      );
      for (let i = 0; i < indices.length; i += 3) {
        const points = [...indices.subarray(i, i + 3)].map((v) =>
          [0, 1, 2].map((lane) => values.getFloat32(v * 28 + lane * 4, true)),
        );
        const a = points[1].map((v, lane) => v - points[0][lane]);
        const b = points[2].map((v, lane) => v - points[0][lane]);
        const cross = [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ];
        if (
          cross.some((v) => Number.isFinite(v) && v !== 0) &&
          raw[indices[i] * 28 + 15] > 0
        )
          observable = true;
      }
    }
    if (!observable)
      throw Error(
        "Zero-position control lacks positive-area colored indexed native geometry",
      );
  }
  nativeVariantEquivalence = {
    cases: native.cases.length,
    frames: native.cases.reduce((n, c) => n + c.frames.length, 0),
    exact: true,
    originalAuthoredFieldOrderPreserved: true,
    positiveAreaColoredGeometryInEveryCase: true,
  };
}
const prepared = await loadLatestDirectEffectPackage({
  load,
  manifestBytes,
  effectIds: [...new Set(native.cases.map((c) => c.effectId))],
});
const current = [...prepared.definitions.values()]
  .flatMap((d) =>
    d.emitters
      .filter((e) =>
        motionMode || zeroMode || orientationMode || rotationMode || softMode
          ? native.cases.some(
              (c) =>
                c.effectId === d.id &&
                c.emitterIndex === e.index &&
                (!orientationMode ||
                  e.placementRequirements.rootBasis === false) &&
                (!rotationMode || e.integratedRotation !== null) &&
                (!softMode || e.softParticlePolicy !== null),
            )
          : e.emitterPosition,
      )
      .map((e) => `${d.id}:${e.index}`),
  )
  .sort();
const selectedNativeCases =
  motionMode || zeroMode || orientationMode || rotationMode || softMode
    ? native.cases.filter(
        (c) =>
          (!zeroMode || c.variant === "authored") &&
          (!orientationMode || c.variant === "true") &&
          (!rotationMode || c.variant === "true") &&
          (!softMode || c.variant === "authored") &&
          prepared.definitions
            .get(c.effectId)
            .emitters.some(
              (e) =>
                e.index === c.emitterIndex &&
                (!orientationMode ||
                  e.placementRequirements.rootBasis === false) &&
                (!rotationMode || e.integratedRotation !== null) &&
                (!softMode || e.softParticlePolicy !== null),
            ),
      )
    : native.cases;
const omittedNativeCases = native.cases.filter(
  (c) =>
    (!zeroMode || c.variant === "authored") && !selectedNativeCases.includes(c),
);
const observed = [
  ...new Set(selectedNativeCases.map((c) => `${c.effectId}:${c.emitterIndex}`)),
].sort();
if (JSON.stringify(current) !== JSON.stringify(observed))
  throw Error("Native position selection differs from compiled components");
for (const [kind, expected] of Object.entries(native.packages ?? {})) {
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
  "tools/compare-direct-position-schedule.mjs",
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
        basis:
          orientationMode || rotationMode
            ? null
            : reference.frames[
                Math.min(Math.round(t * 60), reference.frames.length - 1)
              ].input.basis.filter((_, i) => i < 12 && i % 4 !== 3),
      }),
    },
  });
  const start = mismatches.length;
  const componentKey = `${d.id}:${program.index}`;
  const captureMotion =
    (motionMode || zeroMode || rotationMode || softMode) &&
    !capturedComponents.has(componentKey);
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
              (program.blend === 0 ? index % 4 !== 3 : index % 4 === 3)
                ? Math.max(highest, value)
                : highest,
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
      ...(orientationMode || rotationMode
        ? { schedule: reference.schedule, rootBasisSupplied: false }
        : {}),
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
          "visual:no-positive-vertex-color-and-area-native-compared-frame",
      });
  }
  cases.push({
    effectId: d.id,
    emitterIndex: program.index,
    primitiveKind: reference.primitiveKind,
    pose: reference.pose,
    ...(orientationMode || rotationMode
      ? { schedule: reference.schedule, rootBasisSupplied: false }
      : {}),
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
      omittedNativeCases
        .map((c) => `${c.effectId}:${c.emitterIndex}`)
        .filter((key) => !observed.includes(key)),
    ),
  ],
  omittedNativeControlCases: omittedNativeCases.map((c) => ({
    effectId: c.effectId,
    emitterIndex: c.emitterIndex,
    seedHex: c.seedHex,
    ...(c.schedule ? { schedule: c.schedule } : { pose: c.pose }),
    ...(c.variant ? { variant: c.variant } : {}),
    reason: observed.includes(`${c.effectId}:${c.emitterIndex}`)
      ? "non-authored-native-control-variant"
      : "component-outside-selected-verified-runtime-slice",
  })),
  inputs,
  cases,
  comparisons,
  motionSequences,
  visualOmissions,
  nativeVariantEquivalence,
  visualSamplingPolicy:
    motionMode || zeroMode || rotationMode || softMode
      ? "First native case per component, ten fixed simulation times and a positive-area peak vertex-color sample (premultiplied RGB for blend0, alpha otherwise); supplied moving root, pose and seed"
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
    ...(softMode
      ? {
          nativeDepthDisabledMaterialPolicy: true,
          depthIntersectionImplemented: false,
          actualGraphicsSettingRecovered: false,
        }
      : {}),
    ...(orientationMode || rotationMode
      ? {
          rootBasisSupplied: false,
          nativeMissileBasisRecovered: false,
          nativeOrientationStreamsRetained: false,
        }
      : {}),
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
