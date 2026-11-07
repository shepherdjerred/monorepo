// A bounded verification index for the zero-reference family increment.
// Version33's broad historical audit is preserved, not made source-current.
import { resolve, sep } from "node:path";
import { sha256 } from "../structural-comparison.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Input changed: ${path}`);
  inputs[path] = digest;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
const need = (condition, reason) => {
  if (!condition) throw Error(reason);
};
await raw(import.meta.path);
await raw(resolve(import.meta.dir, "../structural-comparison.mjs"));
const files = [
  "missile-family-regressions-v34.json",
  "direct-session-control.json",
  "jinx-material-contract-v34.json",
  "zero-reference-fixed-time-comparison.json",
  "zero-reference-fixed-time-replay-uniform-comparison.json",
  "zero-reference-fixed-time-replay-event-splits-comparison.json",
  "zero-reference-fixed-time-supplied-interior-split-comparison.json",
  "missile-caster-world-inputs-v33.json",
  "shared-direct-playback-worker-v34-final.json",
  "shared-direct-playback-offscreen-v34.json",
  "direct-effects-delta-v34.json",
  "user-observed-renderer-fix-v34.json",
];
const reports = new Map(),
  verified = [];
for (const file of files) {
  const path = resolve(cache, "research", file),
    report = await read(path);
  let fingerprints = 0;
  for (const [source, digest] of Object.entries(report.inputs ?? {})) {
    need(
      typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest),
      `Non-hash source contract: ${file}: ${source}`,
    );
    need(
      (await sha256(await raw(source))) === digest,
      `Stale selected report: ${file}: ${source}`,
    );
    fingerprints++;
  }
  reports.set(file, report);
  verified.push({
    path,
    sha256: inputs[path],
    inputFingerprints: fingerprints,
  });
}
const family = reports.get(files[0]),
  session = reports.get(files[1]),
  material = reports.get(files[2]);
need(
  family.originalFamilies.length === 2 &&
    family.originalFamilies[0].traces === 52 &&
    family.originalFamilies[1].traces === 10 &&
    family.originalFamilies.every((f) => f.exactTraceMetadata),
  "Original family standalone/composed equality missing",
);
need(
  family.builderSourceControls.length === 2 &&
    family.builderSourceControls.every(
      (b) => b.allOtherSourceBytesEqualVersion33,
    ),
  "Bounded native clock caller source controls missing",
);
need(
  family.addedControls.length === 3 &&
    family.addedControls.every(
      (c) =>
        c.ownerId === 1073741894 &&
        c.causalCreation &&
        c.repeatedPauseAndBackwardQueries,
    ),
  "New decoded owner/causal/pause/seek controls missing",
);
need(
  session.summary.events === 5903 &&
    session.summary.definitions === 180 &&
    session.staticMaterials === 107 &&
    session.committedFrames === 11 &&
    session.controls.realBunModuleWorkers &&
    session.controls.actualSessionFactory &&
    session.controls.backwardSeek &&
    session.controls.cameraWithoutSimulation &&
    session.scope.gpuSubmission === false,
  "Actual ordinary-session/normal restoration contract missing",
);
need(
  material.scope.newShaderPair === false &&
    material.scope.oldNativeReflectionReusedByExactShaderBytes &&
    material.scope.actualNormalCanonicalRestorePassed &&
    material.canonicalCompilationInputs.length === 13 &&
    material.activeSamplers.every((s) => s.type === "sampler2D"),
  "New normal material source/resource closure missing",
);
const native = files.slice(3, 7).map((file) => reports.get(file));
need(
  native.every(
    (r) =>
      r.kind === "translated-zero-reference-fixed-time-original-comparison" &&
      r.cases === 3 &&
      Array.isArray(r.mismatches) &&
      r.mismatches.length === 0,
  ),
  "Original zero-reference comparison failed",
);
const nativeFrames = native.reduce((n, r) => n + r.frames, 0),
  nativeLanes = native.reduce((n, r) => n + r.lanesCompared, 0);
need(
  nativeFrames === 321 && nativeLanes === 8040,
  "Complete original constructor/first-tick/event-split/interior schedule required",
);
const caster = reports.get(files[7]);
need(
  caster.cases.length === 3 &&
    caster.controls.length === 6 &&
    caster.controls.every((control) => control.rejected === true) &&
    caster.scope.sourceBoundRawRigAndCatalogVerified &&
    caster.scope.actualCreationCursorOwned &&
    caster.scope.nativeMatchRootRecovered === false,
  "Owned rig/root provenance controls missing",
);
const timing = reports.get(files[8]),
  budgets = [];
for (const speed of [1, 4]) {
  const rows = timing.schedules.filter((s) => s.speed === speed);
  need(rows.length === 1, "Distinct final worker schedules required");
  const p95 = rows[0].performance.simulationAndGeometryMs.p95,
    limit = speed === 1 ? 4 : 8;
  need(
    Number.isFinite(p95) && p95 <= limit,
    `Worker simulation/geometry budget failed at ${speed}x`,
  );
  budgets.push({
    speed,
    simulationAndGeometryP95Ms: p95,
    limitMs: limit,
    pass: true,
  });
}
need(
  timing.scope.gpuSubmission === false &&
    timing.scope.browserPlaybackObserved === false &&
    timing.performanceScope.browserFpsEstablished === false,
  "Worker-only performance scope lost",
);
const raster = reports.get(files[9]),
  delta = reports.get(files[10]);
need(
  raster.scope.offscreenGpuSubmission === true &&
    raster.scope.actualDecodedReplayPackets === true &&
    raster.scope.worldSceneRendered === false &&
    raster.scope.browserPlaybackObserved === false &&
    raster.counts.prefixContributingCreatorChampions.includes("Jinx") &&
    raster.counts.prefixContributingCreatorChampions.length === 4,
  "New actual creator must contribute in the scoped offscreen framebuffer",
);
need(
  delta.beforeVersion === 33 &&
    delta.afterVersion === 34 &&
    delta.scope.historicalArchivesCompared === true &&
    delta.scope.immutableWorkerArchivesCompared === true &&
    delta.scope.browserAcceptance === false &&
    delta.cohorts[
      "shared-direct"
    ].after.counts.prefixContributingCreatorChampions.includes("Jinx"),
  "Strict immutable version33 to34 shared raster comparison required",
);
const user = reports.get(files[11]);
need(
  user.scope.ordinaryPlayObservedByUser &&
    user.scope.reportedSamplerAndNavigationErrorsAbsent &&
    user.scope.browserSourceHashObserved === null &&
    user.scope.newProjectileFamilyAccepted === false &&
    user.scope.fullAcceptanceEstablished === false,
  "Scoped user renderer observation changed",
);
const testsPath = resolve(cache, "research/v34-tests.log"),
  tests = new TextDecoder().decode(await raw(testsPath));
need(
  /526 pass\s+0 fail\s+10079 expect\(\) calls\s+Ran 526 tests across 109 files\./.test(
    tests,
  ),
  "Final focused suite log missing",
);
const bundlesPath = resolve(cache, "research/v34-bundles.log"),
  bundles = new TextDecoder()
    .decode(await raw(bundlesPath))
    .trim()
    .split(/\r?\n/)
    .map(JSON.parse);
need(
  bundles.length === 3 &&
    bundles.some((b) => b.module === "latest-viewer.mjs") &&
    [
      "latest-direct-effect-worker.mjs",
      "latest-targeted-missile-worker.mjs",
    ].every((name) =>
      bundles.some((b) => b.module === name && b.emulationDependency === false),
    ),
  "Browser bundle/emulation dependency controls missing",
);
async function archive(version, preserved = false) {
  const path = resolve(
      cache,
      `research/direct-effects-v${version}-raster-archive.json`,
    ),
    index = await read(path);
  need(
    index.schema === 1 &&
      index.kind ===
        `immutable-v${version}-effects-raster-report-media-archive` &&
      index.scope.exactBytesCopiedAndReadBack === true,
    "Exact raster archive schema required",
  );
  if (version === 34)
    need(
      index.scope.v33Preserved === true,
      "Prior immutable archive preservation missing",
    );
  const seen = new Set();
  for (const entry of index.artifacts) {
    const target = resolve(entry.archivePath);
    need(
      target.startsWith(cache + sep) && !seen.has(target),
      "Unique in-cache archived paths required",
    );
    seen.add(target);
    const bytes = await raw(target);
    need(
      bytes.length === entry.bytes && (await sha256(bytes)) === entry.sha256,
      `Archived bytes changed: ${target}`,
    );
    if (!preserved) {
      const source = await raw(entry.sourcePath);
      need(
        source.length === entry.bytes &&
          (await sha256(source)) === entry.sha256,
        `Final archive source differs: ${entry.sourcePath}`,
      );
    }
  }
  return {
    path,
    sha256: inputs[path],
    artifacts: index.artifacts.length,
    exactBytesVerified: true,
    preserved,
  };
}
const currentArchive = await archive(34),
  preservedArchive = await archive(33, true);
need(
  preservedArchive.sha256 ===
    "7778be07b12f01d9984c06ca0d9973469609ad67fd73f37676547278fa243d10",
  "Closed version33 archive index changed",
);
for (const [path, digest] of Object.entries(inputs))
  need(
    (await sha256(await Bun.file(path).bytes())) === digest,
    `Input changed during verification: ${path}`,
  );
const output = resolve(cache, "research/direct-focused-verification-v34.json");
const result = {
  schema: 1,
  kind: "bounded-zero-reference-family-increment-verification",
  artifactVersion: 34,
  runtimeProgramVersion: 32,
  reports: verified,
  nativeFrames,
  nativeLanes,
  rasterCounts: raster.counts,
  coverageDelta: {
    addedComponents: delta.cohorts["shared-direct"].addedComponents,
    removedComponents: delta.cohorts["shared-direct"].removedComponents,
  },
  tests: {
    path: testsPath,
    sha256: inputs[testsPath],
    pass: 526,
    fail: 0,
    assertions: 10079,
    files: 109,
  },
  bundles: { path: bundlesPath, sha256: inputs[bundlesPath], results: bundles },
  workerTimingBudget: {
    schedules: budgets,
    workerOnly: true,
    browserAcceptance: false,
  },
  currentArchive,
  preservedArchive,
  inputs,
  scope: {
    selectedIncrementOnly: true,
    historicalVersion33AuditRerun: false,
    networkOnlyRasterRerun: false,
    actualOrdinarySessionRestoration: true,
    nativeMatchFidelity: false,
    newFamilyBrowserAcceptance: false,
    fullComparisonWindowBrowserAcceptance: false,
    fullEffectsPerformanceAcceptance: false,
  },
};
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    sha256: await sha256(await Bun.file(output).bytes()),
    reports: verified.length,
    fingerprints: verified.reduce((n, r) => n + r.inputFingerprints, 0),
    nativeFrames,
    nativeLanes,
    budgets,
    archivedArtifacts: currentArchive.artifacts,
    preservedArtifacts: preservedArchive.artifacts,
    uniqueFiles: Object.keys(inputs).length,
  }),
);
