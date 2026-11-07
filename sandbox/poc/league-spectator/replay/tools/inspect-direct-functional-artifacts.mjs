import { resolve, basename, relative, isAbsolute } from "node:path";
import { sha256 } from "../structural-comparison.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, "..");
const functional = [
  "direct-effects",
  "direct-effect-kernels",
  "direct-birth-native-comparison",
  "direct-pool-deaths-comparison",
  ...[
    "point",
    "loaded",
    "camera",
    "angular",
    "position",
    "motion",
    "blend",
    "ground",
  ].map((name) => `direct-${name}-schedule-comparison`),
  "direct-trail-writer-comparison",
  "direct-trail-math-comparison",
  "direct-trail-asset-comparison",
  "direct-trail-schedule-comparison",
  "direct-worker-checkpoints",
  "direct-trail-worker-checkpoints",
  "direct-presentation-worker-control",
  "direct-renderer-loading",
  "direct-trail-renderer-loading",
  "direct-packet-placement-comparison",
  "direct-parent-flags-comparison",
  "direct-ground-gpu-observation",
  "trail-birth-state-evidence",
  "direct-load-world-control",
  "world-resource-bindings-comparison",
  "resource-requests-comparison",
  "resource-reconstruction-worker-control",
  "unit-resource-mutations-comparison",
  "missile-targets-comparison",
  "missile-tracking-comparison",
  "target-visibility-comparison",
  "target-visibility-masks-comparison",
  "target-visibility-policy-comparison",
  "presentation-targets-comparison",
  "completion-cast-requests-comparison",
  "match-velocity-facing-comparison",
  "fixed-time-movement-comparison",
  "cast-indexed-overrides-comparison",
  "builtin-resource-contexts-comparison",
  "root-attachment-provider-comparison",
  "packet-direction-basis-comparison",
  "viewer-root-attachment-control",
  "initial-resource-prefix-native",
  "initial-resource-playback-worker",
  "shared-direct-playback-worker",
  "direct-session-control",
  "direct-viewer-frame-control",
  "direct-root-audio-comparison",
  "direct-zero-position-schedule-comparison",
  "initial-resource-playback-offscreen",
  "shared-direct-playback-offscreen",
  "flex-bound-size-comparison",
  "direct-particle-orientation-comparison",
  "direct-particle-orientation-schedule-comparison",
  "direct-integrated-rotation-comparison",
  "direct-integrated-rotation-schedule-comparison",
  "direct-retirement-flags-comparison",
  "direct-soft-particles-comparison",
  "direct-soft-particles-schedule-comparison",
  "direct-soft-depth-comparison",
  "shared-viewer-pose-control",
  "direct-quad-sprite-comparison",
  "direct-particle-palette-comparison",
  "direct-particle-palette-rendering",
  "direct-quad-uv-schedule-comparison",
  "network-effect-lifecycle-control",
  "direct-lifecycle-comparison",
  "direct-link-controllers-comparison",
  "direct-value-maximum-comparison",
  "native-raster-conventions-comparison",
  "direct-mesh-geometry-comparison",
  "direct-mesh-record-comparison",
  "direct-mesh-world-order-comparison",
  "direct-mesh-draw-branch-comparison",
  "direct-static-mesh-draw-comparison",
  "direct-static-mesh-bindings",
  "direct-static-mesh-gpu-control",
  "direct-static-mesh-renderer-control",
  "direct-static-mesh-resources-preparation",
  "direct-ray-geometry-native",
  "direct-ray-geometry-comparison",
  "direct-ray-linked-uv-native",
  "direct-ray-linked-uv-comparison",
  "direct-ray-particle-draw-comparison",
  "direct-ray-schedule-comparison",
  "direct-ray-bindings",
  "direct-ray-renderer-control",
  "direct-ray-offscreen",
  "direct-ray-atomicity-control",
  "direct-zero-mesh-flags-native",
  "direct-zero-mesh-flags-comparison",
  "direct-camera-local-offset-native",
  "direct-camera-local-offset-jitter-native",
  "direct-camera-local-offset-comparison",
  "negative-form-listener-native",
  "negative-form-lazy-hero-prefix-native",
  "negative-form-lazy-hero-no-render-native",
  "negative-form-prefix-preparation",
  "direct-emitter-defaults-native",
  "direct-emitter-defaults-comparison",
  "direct-effect-defaults-native",
  "direct-effect-defaults-comparison",
  "asset-json-signed-zero-comparison",
  "direct-legacy-offset-native",
  "direct-legacy-offset-schedule-comparison",
  ...["champions-akshan-20-14ad5334", "champions-jinx-2-3b1dfaaf"].flatMap(
    (id) => [
      `direct-child-unit-resolver-${id}-native`,
      `direct-child-siblings-${id}-authored-native`,
      `direct-child-siblings-${id}-typed-child-null-native`,
    ],
  ),
  "direct-child-sibling-preparation",
  "direct-child-sibling-comparison",
  "direct-mult-uv-native",
  "direct-mult-uv-comparison",
  "direct-mult-runtime-comparison",
  "direct-schedule-regressions-v33",
  "direct-mult-scale-uv-native-v32",
  "direct-mult-scale-uv-comparison-v32",
  "direct-mult-scale-runtime-comparison-v33",
  "direct-mult-scale-demand-v32",
  "direct-compiled-restore-control-v33",
  "missile-effect-basis-native",
  "missile-effect-basis-comparison",
  "fixed-time-basis-worker",
  "navmesh-producer-comparison",
  "navmesh-producer-gpu-replay",
  "navmesh-scene-sampler-native",
  "direct-nav-scene-control",
  "direct-nav-scene-renderer-commands",
  "direct-nav-scene-renderer-gpu-replay",
  "direct-nav-ground-pass-native",
  "direct-nav-ground-material-preparation",
  "direct-nav-ground-material-control",
  "direct-nav-staging-control",
  "direct-nav-ground-renderer-commands",
  "direct-nav-ground-renderer-offscreen",
  "three-uniform-bindings-preparation",
  "native-uniform-limits",
  "direct-uniform-inventory",
  "direct-uniform-reflection-gles-v33",
  "direct-three-uniform-bindings-v33",
  "direct-three-uniform-bindings-gles-v33",
  "direct-sampler-reflection-gles-v33",
  "direct-sampler-bindings-v33",
  "direct-three-sampler-upload-v33",
  "direct-three-sampler-upload-gles-v33",
  "direct-initialization-ownership-v33",
  "raster-baseline-binding-v33",
  "direct-v33-equivalence-current",
  "direct-effects-delta-v33",
];
const historicalTiming = [
  "direct-effect-load-control",
  "direct-loaded-load-control",
  "direct-camera-load-control",
  "direct-angular-load-control",
  "direct-motion-load-control",
  "direct-blend-load-control",
  "direct-inventory-load-control",
  "direct-inventory-v15-load-control",
  "direct-inventory-trails-v16-load-control",
  "direct-inventory-trails-v16-compact-transfer-load-control",
  "direct-inventory-trails-v17-load-control",
  "direct-inventory-trails-v18-load-control",
  "direct-inventory-trails-v20-load-control",
  "direct-inventory-trails-v21-load-control",
  "direct-inventory-trails-v22-load-control",
  "direct-inventory-trails-v23-load-control",
  "shared-direct-playback-worker-v24-final",
  "shared-direct-playback-worker-v25-final",
  "shared-direct-playback-worker-v26-final",
  "shared-direct-playback-worker-v27-final",
  "shared-direct-playback-worker-v28-final",
  "shared-direct-playback-worker-v29-final",
  "shared-direct-playback-worker-v30-final",
  "shared-direct-playback-worker-v31-final",
  "shared-direct-playback-worker-v32-final",
  "shared-direct-playback-worker-v33-browser-concurrent",
];
const currentTimingReports = ["shared-direct-playback-worker-v33-final"];
const historicalVisuals = [
  "effect",
  "loaded",
  "camera",
  "angular",
  "motion",
  "blend",
  "ground",
  "trail",
].map((name) => resolve(cache, "visuals", `direct-${name}-components.json`));
const inputs = new Map(),
  reports = [],
  failures = [];
let fingerprints = 0;
async function digest(path) {
  path = resolve(path);
  if (!inputs.has(path))
    inputs.set(path, await sha256(await Bun.file(path).bytes()));
  return inputs.get(path);
}
async function audit(path, historical = false) {
  path = resolve(path);
  const data = await Bun.file(path).bytes(),
    report = JSON.parse(new TextDecoder().decode(data));
  const row = {
    path,
    sha256: await sha256(data),
    inputFingerprints: 0,
    changedInputs: [],
  };
  if (
    !report.inputs ||
    typeof report.inputs !== "object" ||
    Array.isArray(report.inputs)
  )
    throw Error(`Fingerprint map required: ${path}`);
  if (!historical)
    for (const key of [
      "mismatches",
      "failures",
      "differences",
      "mismatchCount",
      "colorDifferences",
      "uvDifferences",
      "indexDifferences",
    ]) {
      const value = report[key];
      if (
        (Array.isArray(value) && value.length) ||
        (typeof value === "number" && value !== 0)
      )
        throw Error(`Failing functional proof ${basename(path)}:${key}`);
    }
  async function check(file, expected) {
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected))
      throw Error(`Invalid digest in ${path}`);
    const actual = await digest(file);
    row.inputFingerprints++;
    if (actual !== expected)
      row.changedInputs.push({ path: resolve(file), expected, actual });
  }
  for (const [key, value] of Object.entries(report.inputs)) {
    if (key === "producers")
      for (const [file, hash] of Object.entries(value))
        await check(resolve(root, file), hash);
    else if (key === "effectsManifestSha256")
      await check(resolve(cache, "public/latest-effects/manifest.json"), value);
    else await check(key, value);
  }
  if (report.imageSha256)
    await check(
      report.image ?? path.replace(/\.json$/, ".png"),
      report.imageSha256,
    );
  if (report.motionCapture)
    await check(report.motionCapture.path, report.motionCapture.sha256);
  if ((report.visual?.path ?? report.visual?.file) && report.visual?.sha256)
    await check(report.visual.path ?? report.visual.file, report.visual.sha256);
  for (const name of ["staticMeshVisual", "rayVisual"])
    if (report[name] !== undefined) {
      const visual = report[name];
      if (
        !visual ||
        typeof visual !== "object" ||
        Array.isArray(visual) ||
        typeof visual.image !== "string" ||
        !visual.image.length
      )
        throw Error(`Invalid ${name} artifact in ${path}`);
      await check(visual.image, visual.sha256);
    }
  if (report.capture) await check(report.capture.path, report.capture.sha256);
  if (report.captures !== undefined) {
    if (!Array.isArray(report.captures))
      throw Error(`Invalid captures in ${path}`);
    for (const capture of report.captures) {
      if (!capture || typeof capture.path !== "string" || !capture.path.length)
        throw Error(`Invalid captured artifact in ${path}`);
      await check(capture.path, capture.sha256);
    }
  }
  if (!historical) {
    fingerprints += row.inputFingerprints;
    failures.push(
      ...row.changedInputs.map((change) => ({ report: path, ...change })),
    );
  }
  reports.push({ path, sha256: row.sha256 });
  return row;
}
// Source-only planning scan: never writes a functional acceptance report,
// inspects timing, or treats missing/stale reports as passing evidence.
if (process.argv.includes("--scan")) {
  const rows = [],
    errors = [];
  for (const name of functional) {
    const path = resolve(cache, "research", `${name}.json`);
    try {
      rows.push(await audit(path));
    } catch (error) {
      errors.push({ path, error: error.message });
    }
  }
  const output = resolve(cache, "research/v33-stale-artifacts.json"),
    stale = rows.filter((r) => r.changedInputs.length);
  await Bun.write(
    output,
    JSON.stringify(
      {
        schema: 1,
        kind: "source-only-functional-artifact-drift-scan",
        inputs: Object.fromEntries(inputs),
        reports: rows,
        stale,
        errors,
        scope: {
          functionalAcceptanceEstablished: false,
          timingInspected: false,
          historicalArchivesRewritten: false,
        },
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      output,
      reports: rows.length,
      stale: stale.length,
      errors: errors.length,
      uniqueFiles: inputs.size,
    }),
  );
  process.exit(errors.length || stale.length ? 1 : 0);
}
await digest(import.meta.path);
const runtimePath = resolve(root, "latest-direct-effect-runtime.mjs");
await digest(runtimePath);
if (
  !/export const DIRECT_EFFECT_PROGRAM_VERSION = 32;/.test(
    await Bun.file(runtimePath).text(),
  )
)
  throw Error(
    "Version32 runtime contract required for release33 artifact audit",
  );
const current = [];
for (const name of functional)
  current.push(await audit(resolve(cache, "research", `${name}.json`)));
const currentTiming = [];
for (const name of currentTimingReports)
  currentTiming.push({
    ...(await audit(resolve(cache, "research", `${name}.json`))),
    category: "current-actual-replay-worker-timing-input-integrity",
  });
const timingData = await Bun.file(
  resolve(cache, "research", `${currentTimingReports[0]}.json`),
).json();
if (
  !Array.isArray(timingData.schedules) ||
  timingData.schedules.length !== 2 ||
  timingData.schedules.some(
    (s, i) =>
      s.speed !== [1, 4][i] ||
      !Number.isFinite(s.performance?.simulationAndGeometryMs?.p95) ||
      s.performance.simulationAndGeometryMs.p95 < 0,
  )
)
  throw Error("Complete measured release33 worker schedules at1x/4x required");
const workerTimingBudget = {
  sourceReport: currentTiming[0].path,
  sourceSha256: currentTiming[0].sha256,
  schedules: timingData.schedules.map((s) => ({
    speed: s.speed,
    simulationAndGeometryP95Ms: s.performance.simulationAndGeometryMs.p95,
    limitMs: s.speed === 1 ? 4 : 8,
    passes:
      s.performance.simulationAndGeometryMs.p95 <= (s.speed === 1 ? 4 : 8),
  })),
  workerOnly: true,
  browserAcceptance: false,
};
workerTimingBudget.accepted = workerTimingBudget.schedules.every(
  (s) => s.passes,
);
async function verifyRasterArchive(version) {
  const rasterArchivePath = resolve(
    cache,
    `research/direct-effects-v${version}-raster-archive.json`,
  );
  await digest(rasterArchivePath);
  const archive = await Bun.file(rasterArchivePath).json();
  if (
    archive.schema !== 1 ||
    archive.kind !==
      `immutable-v${version}-effects-raster-report-media-archive` ||
    !Array.isArray(archive.artifacts) ||
    !archive.artifacts.length ||
    archive.scope?.exactBytesCopiedAndReadBack !== true ||
    archive.scope?.[`v${version - 1}Preserved`] !== true
  )
    throw Error(
      `Complete immutable version${version} raster archive index required`,
    );
  const archivedPaths = new Set();
  for (const artifact of archive.artifacts) {
    if (
      typeof artifact?.archivePath !== "string" ||
      !artifact.archivePath ||
      typeof artifact.sourcePath !== "string" ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 1
    )
      throw Error("Exact raster archive path, bytes and content hash required");
    const path = resolve(artifact.archivePath),
      within = relative(cache, path);
    if (
      isAbsolute(within) ||
      within === ".." ||
      within.startsWith("..\\") ||
      within.startsWith("../") ||
      archivedPaths.has(path)
    )
      throw Error("Unique raster archive path inside cache required");
    archivedPaths.add(path);
    if (
      Bun.file(path).size !== artifact.bytes ||
      (await digest(path)) !== artifact.sha256
    )
      throw Error(`Immutable raster archive changed: ${path}`);
  }
  return {
    path: rasterArchivePath,
    sha256: await digest(rasterArchivePath),
    artifacts: archivedPaths.size,
    archiveBytesVerified: true,
    canonicalInputsVerifiedSeparately: version === 33,
    sourceDriftInsideHistoricalReportsAllowed: version < 33,
  };
}
const preservedVersion32RasterArchive = await verifyRasterArchive(32),
  immutableRasterArchive = await verifyRasterArchive(33);
const historical = [];
for (const name of [
  "direct-functional-verification-audit-v32",
  "direct-schedule-regressions-v32",
  "direct-mult-scale-runtime-comparison-v32",
  "direct-compiled-restore-control-v32",
  "direct-initialization-ownership-v32",
  "shared-direct-playback-offscreen-v32",
  "initial-resource-playback-offscreen-v32",
  "shared-direct-playback-offscreen-v32-comparable",
  "direct-effects-delta-v32",
])
  historical.push({
    ...(await audit(resolve(cache, "research", `${name}.json`), true)),
    category: "immutable-historical-v32-control",
  });
historical.push({
  ...(await audit(
    resolve(cache, "research/direct-schedule-regressions-v31.json"),
    true,
  )),
  category: "immutable-historical-v31-schedule-regression-control",
});
historical.push({
  ...(await audit(
    resolve(cache, "research/direct-functional-verification-audit-v31.json"),
    true,
  )),
  category: "immutable-historical-v31-consolidated-audit",
});
for (const name of [
  "shared-direct-playback-offscreen-v31",
  "initial-resource-playback-offscreen-v31",
])
  historical.push({
    ...(await audit(resolve(cache, "research", `${name}.json`), true)),
    category: "immutable-historical-v31-offscreen-raster",
  });
historical.push({
  ...(await audit(
    resolve(cache, "research/direct-functional-verification-audit-v30.json"),
    true,
  )),
  category: "immutable-historical-v30-consolidated-audit",
});
for (const name of [
  "shared-direct-playback-offscreen-v30",
  "initial-resource-playback-offscreen-v30",
])
  historical.push({
    ...(await audit(resolve(cache, "research", `${name}.json`), true)),
    category: "immutable-historical-v30-offscreen-raster",
  });
historical.push({
  ...(await audit(
    resolve(cache, "research/direct-functional-verification-audit-v29.json"),
    true,
  )),
  category: "immutable-historical-v29-consolidated-audit",
});
for (const name of [
  "shared-direct-playback-offscreen-v29",
  "initial-resource-playback-offscreen-v29",
])
  historical.push({
    ...(await audit(resolve(cache, "research", `${name}.json`), true)),
    category: "immutable-historical-v29-offscreen-raster",
  });
historical.push({
  ...(await audit(
    resolve(cache, "research/direct-functional-verification-audit-v28.json"),
    true,
  )),
  category: "immutable-historical-v28-consolidated-audit",
});
for (const name of [
  "shared-direct-playback-offscreen-v28",
  "initial-resource-playback-offscreen-v28",
])
  historical.push({
    ...(await audit(resolve(cache, `research/${name}.json`), true)),
    category: "immutable-historical-v28-offscreen-raster",
  });
historical.push({
  ...(await audit(
    resolve(cache, "research/direct-functional-verification-audit-v27.json"),
    true,
  )),
  category: "immutable-historical-v27-consolidated-audit",
});
for (const name of [
  "shared-direct-playback-offscreen-v27",
  "initial-resource-playback-offscreen-v27",
])
  historical.push({
    ...(await audit(resolve(cache, `research/${name}.json`), true)),
    category: "immutable-historical-v27-offscreen-raster",
  });
historical.push({
  ...(await audit(
    resolve(cache, "research/direct-functional-verification-audit-v26.json"),
    true,
  )),
  category: "immutable-historical-v26-consolidated-audit",
});
historical.push({
  ...(await audit(
    resolve(cache, "research/direct-functional-verification-audit-v25.json"),
    true,
  )),
  category: "immutable-historical-v25-consolidated-audit",
});
historical.push({
  ...(await audit(
    resolve(cache, "research/direct-functional-verification-audit-v24.json"),
    true,
  )),
  category: "immutable-historical-v24-consolidated-audit",
});
for (const name of historicalTiming)
  historical.push({
    ...(await audit(resolve(cache, "research", `${name}.json`), true)),
    category: "immutable-historical-timing",
  });
for (const path of historicalVisuals)
  historical.push({
    ...(await audit(path, true)),
    category: "historical-offscreen-raster",
  });
historical.push({
  ...(await audit(
    resolve(cache, "research/direct-functional-verification-audit-v23.json"),
    true,
  )),
  category: "immutable-historical-v23-consolidated-audit",
});
historical.push({
  ...(await audit(
    resolve(cache, "research/direct-ground-fow-rendering.json"),
    true,
  )),
  category: "historical-eight-component-ground-offscreen-raster",
});
historical.push({
  ...(await audit(
    resolve(cache, "research/direct-v16-verification-audit.json"),
    true,
  )),
  category: "historical-consolidated-audit",
});
historical.push({
  ...(await audit(
    resolve(cache, "research/direct-functional-verification-audit-v18.json"),
    true,
  )),
  category: "immutable-historical-v18-consolidated-audit",
});
historical.push({
  ...(await audit(
    resolve(cache, "research/direct-functional-verification-audit-v20.json"),
    true,
  )),
  category: "immutable-historical-v20-consolidated-audit",
});
historical.push({
  ...(await audit(
    resolve(cache, "research/direct-functional-verification-audit-v21.json"),
    true,
  )),
  category: "immutable-historical-v21-consolidated-audit",
});
historical.push({
  ...(await audit(
    resolve(cache, "research/direct-functional-verification-audit-v22.json"),
    true,
  )),
  category: "immutable-historical-v22-consolidated-audit",
});
historical.push({
  ...(await audit(
    resolve(
      cache,
      "research/shared-direct-playback-worker-pre-pose-optimization.json",
    ),
    true,
  )),
  category: "historical-v22-pose-performance-regression-before-optimization",
});
const finalSuitePath = resolve(cache, "research/v33-tests-final.log"),
  finalSuiteText = await Bun.file(finalSuitePath).text();
if (
  !/^\s*515 pass\s*$/m.test(finalSuiteText) ||
  !/^\s*0 fail\s*$/m.test(finalSuiteText) ||
  !/^\s*9882 expect\(\) calls\s*$/m.test(finalSuiteText) ||
  !/^Ran 515 tests across 107 files\./m.test(finalSuiteText)
)
  throw Error("Complete final release33 focused test log required");
const focusedTests = {
  path: finalSuitePath,
  sha256: await digest(finalSuitePath),
  passed: 515,
  failed: 0,
  assertions: 9882,
  files: 107,
  scope: "replay-focused Bun suite; exhaustive monorepo CI is separate",
};
for (const [path, hash] of inputs)
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Input changed during audit: ${path}`);
for (const row of reports)
  if ((await sha256(await Bun.file(row.path).bytes())) !== row.sha256)
    throw Error(`Report changed during audit: ${row.path}`);
const result = {
  schema: 1,
  kind: "current-direct-functional-artifact-integrity-control",
  releaseVersion: 33,
  runtimeProgramVersion: 32,
  inputs: Object.fromEntries([
    ...inputs,
    ...reports.map((row) => [row.path, row.sha256]),
  ]),
  current,
  currentTiming,
  workerTimingBudget,
  immutableRasterArchive,
  preservedVersion32RasterArchive,
  currentInputFingerprintsChecked: fingerprints,
  uniqueFilesChecked: inputs.size,
  failures,
  historical,
  focusedTests,
  scope: {
    currentFunctionalInputs: failures.length === 0,
    currentTimingInputsVerified:
      currentTiming.length > 0 &&
      currentTiming.every((row) => !row.changedInputs.length),
    immutableRasterArchiveVerified: true,
    preservedVersion32RasterArchiveVerified: true,
    performanceAcceptanceEstablished: false,
    historicalTimingRewritten: false,
    newTimingMeasurement: false,
    offscreenRenderingExecutedByAudit: false,
    nativeMatchAcceptance: null,
    browserPlayback: false,
  },
};
const output = resolve(
  cache,
  "research/direct-functional-verification-audit.json",
);
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    functionalReports: current.length,
    currentTimingReports: currentTiming.length,
    currentInputFingerprintsChecked: fingerprints,
    uniqueFilesChecked: inputs.size,
    failures: failures.length,
    historicalReports: historical.length,
    historicalWithChangedInputs: historical.filter(
      (row) => row.changedInputs.length,
    ).length,
  }),
);
if (failures.length) process.exitCode = 1;
