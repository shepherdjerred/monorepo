// Bounded depth-bias increment evidence; historical archives are byte-checked,
// never reinterpreted as source-current proof for this increment.
import { resolve, sep } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  inputs = {};
const need = (condition, message) => {
  if (!condition) throw Error(message);
};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  need(!inputs[path] || inputs[path] === hash, "Index input drift: " + path);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const names = [
    "direct-depth-bias-native-v35",
    "direct-depth-bias-comparison-v35",
    "direct-depth-bias-gles-v35",
    "direct-effects",
    "direct-renderer-loading",
    "direct-session-control",
    "shared-direct-playback-worker-v35-final",
    "shared-direct-playback-offscreen-v35",
    "direct-effects-delta-v35",
    "direct-depth-bias-visual-crop-v35",
  ],
  reports = new Map(),
  verified = [];
for (const name of names) {
  const path = resolve(cache, `research/${name}.json`),
    report = await read(path);
  let count = 0;
  const hashes =
    name === "direct-effects"
      ? Object.fromEntries(
          Object.entries(report.inputs.producers).map(([p, h]) => [
            resolve(root, p),
            h,
          ]),
        )
      : report.inputs;
  for (const [source, hash] of Object.entries(hashes)) {
    need(
      typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash),
      "Exact source hash required: " + name,
    );
    need(
      (await sha256(await raw(source))) === hash,
      `Stale bounded report: ${name}: ${source}`,
    );
    count++;
  }
  if (name === "direct-effects")
    need(
      (await sha256(
        await raw(resolve(cache, "public/latest-effects/manifest.json")),
      )) === report.inputs.effectsManifestSha256,
      "Admission effects manifest changed",
    );
  reports.set(name, report);
  verified.push({ path, sha256: inputs[path], inputFingerprints: count });
}
const native = reports.get(names[0]),
  comparison = reports.get(names[1]),
  gles = reports.get(names[2]),
  admission = reports.get(names[3]),
  renderer = reports.get(names[4]),
  session = reports.get(names[5]),
  worker = reports.get(names[6]),
  raster = reports.get(names[7]),
  delta = reports.get(names[8]),
  crop = reports.get(names[9]);
need(
  native.cases.length === 9 &&
    native.cases.every((c) => c.passes.length === 7) &&
    comparison.cases.length === 9 &&
    comparison.passes === 63 &&
    comparison.rejections === 3,
  "Complete native/THREE depth state cohort required",
);
need(
  gles.cases.length === 9 &&
    gles.restoredDraws.length === 3 &&
    gles.cases.every((c) => c.native.sha256 === c.compiled.sha256) &&
    gles.scope.realGLESDepthAttachment &&
    gles.scope.leagueShaderPixelParity === false,
  "Scoped original state/GLES fixture required",
);
need(
  admission.runtimeVersion === 35 ||
    admission.contract?.runtimeVersion === 35 ||
    worker.policy.runtimeVersion === 35,
  "Runtime35 program contract required",
);
need(
  renderer.summary.depthBiasPrograms.length === 6 &&
    renderer.summary.depthBiasPrograms.every(
      (p) => p.actualThreeMaterialStateVerified,
    ),
  "Actual source-bound THREE factors required",
);
need(
  session.summary.events === 5903 &&
    session.summary.definitions === 180 &&
    session.staticMaterials === 113 &&
    session.compiledPresentationPrograms.depthBias === 6 &&
    session.controls.backwardSeek &&
    session.controls.cameraWithoutSimulation &&
    session.scope.gpuSubmission === false,
  "Current ordinary session/metadata control required",
);
const budgets = [1, 4].map((speed) => {
  const rows = worker.schedules.filter((s) => s.speed === speed);
  need(rows.length === 1, "One final timing schedule per speed required");
  const p95 = rows[0].performance.simulationAndGeometryMs.p95,
    limit = speed === 1 ? 4 : 8;
  need(Number.isFinite(p95) && p95 <= limit, "Worker budget failed");
  return { speed, p95Ms: p95, limitMs: limit, pass: true };
});
need(
  worker.scope.gpuSubmission === false &&
    worker.performanceScope.browserFpsEstablished === false,
  "Worker-only timing scope required",
);
need(
  raster.scope.offscreenGpuSubmission &&
    raster.scope.worldSceneRendered === false &&
    raster.scope.browserPlaybackObserved === false &&
    raster.counts.prefixContributingInstances === 165 &&
    raster.counts.prefixContributingDefinitions === 27 &&
    raster.counts.prefixContributingComponents === 611 &&
    raster.counts.prefixContributingCreatorChampions.length === 4,
  "Current mixed offscreen scope/coverage required",
);
const change = delta.cohorts["shared-direct"];
need(
  delta.beforeVersion === 34 &&
    delta.afterVersion === 35 &&
    change.addedComponents.length === 4 &&
    change.removedComponents.length === 0 &&
    change.addedComponents.every(
      (c) =>
        c.definitionId === "champions/karthus/10/ce863744" && c.emitterId === 4,
    ),
  "Exact bounded4-added/0-removed coverage delta required",
);
need(
  crop.scope.originalProjectionAndDrawsUnchanged &&
    crop.scope.mixedEffectsOverlap &&
    crop.scope.isolatedComponentPixelsClaimed === false &&
    crop.frames.length === 9,
  "Faithful mixed saved-frame crop scope required",
);
for (const output of crop.outputs)
  need(
    (await sha256(await raw(output.path))) === output.sha256,
    "Visual crop bytes changed",
  );
await raw(raster.image);
need(
  inputs[resolve(raster.image)] === raster.imageSha256,
  "Raster contact image changed",
);
await raw(raster.capture.path);
need(
  inputs[resolve(raster.capture.path)] === raster.capture.sha256,
  "Raster capture changed",
);
const testsPath = resolve(cache, "research/v35-tests-final.log"),
  testText = new TextDecoder().decode(await raw(testsPath));
need(
  /564 pass\s+0 fail\s+10398 expect\(\) calls\s+Ran 564 tests across 119 files\./.test(
    testText,
  ),
  "Final full-suite log required",
);
const bundlesPath = resolve(cache, "research/v35-bundles-final.log"),
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
    ].every((module) =>
      bundles.some(
        (b) => b.module === module && b.emulationDependency === false,
      ),
    ),
  "Current browser bundle contracts required",
);
await captureDirectSourceInputs(
  [
    "latest-selected-world-state.mjs",
    "latest-world-state.mjs",
    "latest-world-state-contract.mjs",
    "latest-selected-world-state.test.mjs",
    "tools/inspect-selected-world-state.mjs",
    "tools/prepare-selected-static-catalog.mjs",
  ].map((p) => resolve(root, p)),
  raw,
);
const preserved = [];
for (const name of [
  "direct-effects-v32-comparable-archive",
  "direct-effects-v32-raster-archive",
  "direct-effects-v33-raster-archive",
  "direct-effects-v34-raster-archive",
]) {
  const path = resolve(cache, `research/${name}.json`),
    manifest = await read(path),
    seen = new Set();
  for (const entry of manifest.artifacts) {
    const target = resolve(entry.archivePath ?? entry.path);
    need(
      target.startsWith(cache + sep) && !seen.has(target),
      "Unique in-cache preserved archive paths required",
    );
    seen.add(target);
    const bytes = await raw(target);
    need(
      bytes.length === entry.bytes && (await sha256(bytes)) === entry.sha256,
      "Preserved archived bytes changed: " + target,
    );
  }
  preserved.push({
    path,
    sha256: inputs[path],
    entries: manifest.artifacts.length,
    archivedBytesVerified: true,
    historicalSourcesReaudited: false,
  });
}
need(
  preserved.reduce((n, r) => n + r.entries, 0) === 226,
  "Complete prior226 archived entries required",
);
for (const [path, hash] of Object.entries(inputs))
  need(
    (await sha256(await Bun.file(path).bytes())) === hash,
    "Final bounded index drift: " + path,
  );
const output = resolve(cache, "research/direct-focused-verification-v35.json"),
  result = {
    schema: 1,
    kind: "bounded-original-depth-bias-increment-verification",
    artifactVersion: 35,
    runtimeProgramVersion: 35,
    reports: verified,
    native: {
      cases: 9,
      passes: 63,
      threeCommands: comparison.commands.length,
      explicitRejections: 3,
      glesCases: 9,
      glesRestoredDraws: 3,
    },
    tests: {
      path: testsPath,
      sha256: inputs[testsPath],
      pass: 564,
      fail: 0,
      assertions: 10398,
      files: 119,
    },
    bundles: {
      path: bundlesPath,
      sha256: inputs[bundlesPath],
      results: bundles,
    },
    workerTimingBudget: {
      schedules: budgets,
      workerOnly: true,
      browserAcceptance: false,
    },
    rasterCounts: raster.counts,
    coverageDelta: {
      addedComponents: change.addedComponents,
      removedComponents: change.removedComponents,
    },
    visualCrop: {
      reportPath: resolve(
        cache,
        "research/direct-depth-bias-visual-crop-v35.json",
      ),
      rectangle: crop.frames[0].cropRectangleLTRB,
      frameIndices: crop.frames.map((f) => f.gifFrameIndex),
      outputs: crop.outputs,
      scope: crop.scope,
    },
    selectedWorldStateReview: {
      p0p2Findings: [],
      sourceReviewed: true,
      completeSchemaEqualityExceptSceneParent: true,
      fixedNativeReferenceRequired: true,
      ownedSelectionRequired: true,
      arbitraryMapSupportEstablished: false,
      independentCLIExecutedByThisIndex: false,
    },
    preservedArchives: preserved,
    inputs,
    scope: {
      boundedIncrementOnly: true,
      wholeHistoricalAuditRerun: false,
      historicalArchivesByteCheckedOnly: true,
      ordinarySessionRestoration: true,
      mixedOffscreenActualPackets: true,
      newCreatorEstablished: false,
      worldSceneRenderingVerified: false,
      browserAcceptance: false,
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
    uniqueFiles: Object.keys(inputs).length,
    preservedEntries: 226,
    budgets,
  }),
);
