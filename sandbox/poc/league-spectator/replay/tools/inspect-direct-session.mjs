// Execute the actual ordinary session factory, real workers and real THREE
// renderer loader. No DOM, browser or GPU submission is claimed by this tool.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { loadLatestInitialResourcePrefix } from "../latest-initial-resource-prefix.mjs";
import { createLatestEffectPipeline } from "../latest-effect-pipeline.mjs";
import { createLatestResourceRequestTrack } from "../latest-resource-requests.mjs";
import { LatestSpectatorDiagnostics } from "../latest-spectator-diagnostics.mjs";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { sameDirectCompiledData } from "../latest-direct-compiled-restore.mjs";
import { captureDirectSessionPlayback } from "./capture-direct-session-playback.mjs";
import { loadLatestSelectedMaterialRegistry } from "../latest-selected-materials.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  inputs = {};
const origin = new URL(process.argv[3] ?? "http://127.0.0.1:4180");
const selectedMode = process.argv.includes("--selected-static"),
  selectedReconstruction = process.argv.includes("--selected-reconstruction"),
  capturePlayback = process.argv.includes("--capture-playback"),
  controlName = selectedMode
    ? "direct-session-selected-control"
    : "direct-session-control";
if (selectedReconstruction && !selectedMode)
  throw Error("Selected reconstruction requires --selected-static");
if (capturePlayback && !selectedReconstruction)
  throw Error("Session playback capture requires --selected-reconstruction");
const raw = async (path) => {
  path = resolve(path);
  const data = await Bun.file(path).bytes(),
    digest = await sha256(data);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Input changed: ${path}`);
  inputs[path] = digest;
  return data;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs(
  [
    import.meta.path,
    resolve(root, "latest-direct-effect-session.mjs"),
    resolve(root, "latest-direct-effect-worker.mjs"),
    resolve(root, "latest-targeted-missile-worker.mjs"),
  ],
  raw,
);
await raw(`${cache}/public/vendor/three.module.js`);
const exported = await read(
  `${cache}/research/${selectedReconstruction ? "selected-reconstruction-control" : "viewer-root-reconstruction"}.json`,
);
if (selectedReconstruction) {
  if (
    exported.kind !== "actual-selected-ordinary-reconstruction-control" ||
    exported.scope?.actualModuleWorker !== true ||
    exported.scope.ordinaryReconstructionFunction !== true ||
    exported.scope.decodedInWorker !== true ||
    exported.scope.effectsRendered !== false ||
    resolve(exported.reportPath) !==
      resolve(cache, "research/selected-ordinary-reconstruction.json")
  )
    throw Error("Fresh selected ordinary-worker diagnostic control required");
} else if (
  exported.kind !== "verified-ordinary-reconstruction-diagnostic-export" ||
  exported.runtimePlaybackInput !== false
)
  throw Error("Fresh ordinary-worker diagnostic report required");
for (const [path, digest] of Object.entries(exported.inputs))
  if ((await sha256(await raw(path))) !== digest)
    throw Error(`Stale reconstruction: ${path}`);
let report;
if (selectedReconstruction) {
  const reportBytes = await raw(exported.reportPath);
  if ((await sha256(reportBytes)) !== exported.reportSha256)
    throw Error("Selected ordinary reconstruction report changed");
  report = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(reportBytes),
  );
} else {
  if (
    (await sha256(await raw(exported.controlReportPath))) !==
    exported.controlReportSha256
  )
    throw Error("Ordinary reconstruction control changed");
  report = exported.report;
}
const scene = await read(`${cache}/public/latest-scene/manifest.json`);
const manifestBytes = await load("latest-effects/manifest.json"),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
const staticCatalog = selectedMode
  ? await loadLatestStaticCatalogSelection({ load })
  : null;
if (
  selectedReconstruction &&
  !sameDirectCompiledData(exported.catalog, staticCatalog.describe())
)
  throw Error("Selected reconstruction and session static roots differ");
const selectedMaterials =
  staticCatalog === null
    ? null
    : await loadLatestSelectedMaterialRegistry({ staticCatalog, load });
for (const name of ["motion", "controllers", "actors"])
  await load(`decoder-16.21-macos/missile-${name}.json`);
for (const hero of report.heroes)
  await load(
    `latest-scene/${scene.champions[`${hero.champion.toLowerCase()}/${hero.skinId}`].spellCatalog}`,
  );
const initial = await loadLatestInitialResourcePrefix({
  profile,
  load,
  manifestBytes,
  report,
  staticCatalog,
});
const prefixInvalidations = [],
  prefixPreservations = [],
  orderedRequests = createLatestResourceRequestTrack(
    report.resourceRequests,
  ).records;
for (const hero of report.heroes) {
  const requests = orderedRequests.filter(
    (request) => request.entityId === hero.entityId,
  );
  for (const first of requests) {
    const cursor = {
      transportSequence: first.transportSequence,
      entryOrder: first.entryOrder,
    };
    const before = initial.policy.query(hero.entityId, first.time, {
      ...cursor,
      exclusive: true,
    });
    const after = initial.policy.query(hero.entityId, first.time, cursor);
    const classified = initial.policy.negativeFormPrefix.classify(hero, first);
    if (!before.stack)
      throw Error(
        "Actual request's prior conditional prefix was already unknown",
      );
    if (classified) {
      if (
        after.stack?.base.id !== before.stack.base.id ||
        after.sourceEventId !== before.sourceEventId ||
        !after.prefixPreservingRequestObservations.some(
          (o) =>
            o.sourceEventId === first.id &&
            o.nativeAcceptance === null &&
            o.nativeSnapshotRestoration === null,
        )
      )
        throw Error(
          "Verified negative-form observation failed its conditional preservation contract",
        );
    } else if (after.stack !== null || after.blockingRequest?.id !== first.id)
      throw Error(
        "Actual first unsupported request did not invalidate its conditional prefix causally",
      );
    if (
      initial.policy.query(hero.entityId, first.time, {
        ...cursor,
        exclusive: true,
      }).sourceEventId !== before.sourceEventId
    )
      throw Error("Backward prefix query changed its creation source identity");
    (classified ? prefixPreservations : prefixInvalidations).push({
      entityId: hero.entityId,
      champion: hero.champion,
      requestId: first.id,
      sourceEventId: before.sourceEventId,
      beforeStatus: before.status,
      afterStatus: after.status,
      ...(classified
        ? {
            policy: classified.policy,
            stream: first.stream,
            nativeAcceptance: null,
            nativeSnapshotRestoration: null,
          }
        : {}),
    });
    if (!classified) break;
  }
}
const pipeline = initial.resolvers.bindTimeline(
  await createLatestEffectPipeline({
    report,
    effectsManifestBytes: manifestBytes,
    quadGpuBytes:
      selectedMaterials === null
        ? await load("latest-complete-quad-gpu/package.json")
        : selectedMaterials.packageBytes("quad"),
    trailGpuBytes:
      selectedMaterials === null
        ? await load("latest-trail-particles/gpu.json")
        : selectedMaterials.packageBytes("trail"),
    selectedMaterials,
  }),
  report,
);
const external = new Set([
  "latest-direct-effect-client.mjs",
  "latest-targeted-missile-client.mjs",
  "latest-direct-initialization-ownership.mjs",
  "latest-static-catalog.mjs",
]);
const bundle = await Bun.build({
  entrypoints: [resolve(root, "latest-direct-effect-session.mjs")],
  target: "bun",
  external: ["/assets/*"],
  write: false,
  plugins: [
    {
      name: "pinned-three-real-workers",
      setup(build) {
        build.onResolve({ filter: /^three$/ }, () => ({
          path: `${cache}/public/vendor/three.module.js`,
        }));
        build.onResolve(
          {
            filter:
              /latest-((direct-effect|targeted-missile)-client|direct-initialization-ownership|static-catalog)\.mjs$/,
          },
          ({ path }) =>
            external.has(path.split("/").at(-1))
              ? { path: resolve(root, path.split("/").at(-1)), external: true }
              : undefined,
        );
      },
    },
  ],
});
if (!bundle.success || bundle.outputs.length !== 1)
  throw new AggregateError(bundle.logs, "Actual session bundle failed");
const bundlePath = `${cache}/research/${controlName}.bundle.mjs`;
await Bun.write(bundlePath, bundle.outputs[0]);
await raw(bundlePath);
const { createLatestDirectEffectSession } = await import(
  pathToFileURL(bundlePath).href
);
const THREE = await import(
  pathToFileURL(`${cache}/public/vendor/three.module.js`).href
);
const originalFetch = globalThis.fetch,
  requests = [];
globalThis.fetch = async (url, options) => {
  const response = await originalFetch(url, options),
    target = new URL(String(url));
  if (
    target.origin === origin.origin &&
    target.pathname.startsWith("/assets/")
  ) {
    if (response.status !== 200)
      throw Error(`Session asset HTTP ${response.status}: ${target.pathname}`);
    const data = new Uint8Array(await response.clone().arrayBuffer());
    const local = resolve(
      `${cache}/public`,
      decodeURIComponent(target.pathname.slice("/assets/".length)),
    );
    if ((await sha256(data)) !== (await sha256(await raw(local))))
      throw Error(`Served session asset differs: ${target.pathname}`);
    requests.push({ path: target.pathname, bytes: data.byteLength });
  }
  return response;
};
let session, result, playbackCapture;
try {
  const group = new THREE.Group();
  session = await createLatestDirectEffectSession({
    world: group,
    report,
    scene,
    sceneManifestBytes: (await load("latest-scene/manifest.json")).buffer,
    navigationMode: "loader-only-no-gpu",
    manifest,
    // Match latest-viewer get(path, true), which returns fetch().arrayBuffer().
    manifestBytes: manifestBytes.slice().buffer,
    pipeline,
    missilePlayback: { traces: [], omitted: [] },
    assetBase: new URL("/assets/", origin).href,
    staticCatalog,
    selectedMaterials,
  });
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 1, 20000);
  camera.position.set(7500, 1000, 9000);
  camera.lookAt(7500, 0, 7500);
  camera.updateMatrixWorld(true);
  let peak = 0,
    committedFrames = 0,
    completeCoverage;
  // Exercise the passive export contract with actual committed worker metrics.
  // This CLI control supplies its recording clock and is not browser evidence.
  const timingRecorder = new LatestSpectatorDiagnostics({
    replayHash: report.replaySha256,
    comparisonWindow: [69, 99],
  });
  function recordCommit(presentation, playing) {
    timingRecorder.frame({
      wallTime: performance.now(),
      replayHash: report.replaySha256,
      replayTime: presentation.time,
      presentedTime: presentation.time,
      playing,
      speed: 1,
      mode: "shared effects",
      effectsEnabled: true,
      effectsVisible: true,
      directEffectFrame: {
        requestId: presentation.requestId,
        time: presentation.packet.time,
        operation: presentation.operation,
        metrics: session.renderer.frameMetrics,
      },
    });
  }
  for (const time of [
    0, 69, 69.2, 70, 71.517, 75, 84.733, 94.633, 99, 68, 71.517,
  ]) {
    const presentation = await session.requestPresentation(time, camera);
    if (!session.isPresentationCurrent(presentation))
      throw Error("Actual session returned a stale presentation");
    const packet = presentation.packet;
    session.renderer.commitDirect(packet, camera);
    recordCommit(presentation, true);
    peak = Math.max(peak, session.renderer.directMeshes.size);
    committedFrames++;
    if (time === 99) completeCoverage = await session.client.coverage();
  }
  const before = await session.client.checkpoint();
  camera.position.x += 300;
  camera.updateMatrixWorld(true);
  const pausedPresentation = await session.requestPresentation(71.517, camera);
  const paused = pausedPresentation.packet;
  session.renderer.commitDirect(paused, camera);
  recordCommit(pausedPresentation, false);
  if (
    paused.metrics.simulationStepsAdvanced !== 0 ||
    JSON.stringify(await session.client.checkpoint()) !== JSON.stringify(before)
  )
    throw Error("Actual session camera-only request advanced simulation");
  const recordedTimings = timingRecorder.finish();
  if (
    recordedTimings.cohorts.effects1x.directEffects.committedFrames !== 9 ||
    recordedTimings.cohorts.effects1x.directEffects.simulationAdvances !== 9 ||
    recordedTimings.cohorts.paused.directEffects.cameraRedraws !== 1 ||
    recordedTimings.cohorts.paused.directEffects.simulationMs.maximum !== 0 ||
    recordedTimings.cohorts.worldOnly.directEffects.committedFrames !== 0
  )
    throw Error("Actual session committed timing attribution differs");
  const diagnostic = await session.inspect();
  const components = diagnostic.definitions.flatMap(
    (definition) => definition.components,
  );
  if (
    components.some(
      (component) =>
        [
          "spriteProgram",
          "paletteProgram",
          "paletteTexture",
          "depthBiasProgram",
        ].some((key) => !Object.hasOwn(component, key)) ||
        (component.paletteProgram !== null &&
          component.paletteTexture === null),
    )
  )
    throw Error("Complete sprite/palette diagnostic metadata required");
  const compiledPresentationPrograms = {
    depthBias: components.filter(
      (component) => component.depthBiasProgram !== null,
    ).length,
    sprite: components.filter((component) => component.spriteProgram !== null)
      .length,
    palette: components.filter((component) => component.paletteProgram !== null)
      .length,
  };
  for (const definition of diagnostic.definitions)
    for (const component of definition.components) {
      const program = component.depthBiasProgram;
      if (program === null) continue;
      const key = `${definition.id}:${component.id}`,
        binding = component.navGroundProgram
          ? session.renderer.navGroundRenderer?.bindings.get(key)
          : session.renderer.gpuMaterials.get(key);
      if (
        !binding ||
        binding.material.polygonOffset !== program.enabled ||
        !Object.is(binding.material.polygonOffsetFactor, program.slope) ||
        !Object.is(binding.material.polygonOffsetUnits, program.constant)
      )
        throw Error(
          "Session depth-bias diagnostic differs from actual THREE material",
        );
    }
  const prefixRows = completeCoverage.rows.filter(
    (row) => row.resourceEvidence?.units?.length,
  );
  if (
    !prefixRows.length ||
    prefixRows.some(
      (row) =>
        row.resourceEvidence.nativeAcceptance !== null ||
        row.resourceEvidence.units.some(
          (unit) =>
            unit.nativeAcceptance !== null ||
            (unit.sourceEventId !== undefined &&
              !unit.sourceEventId.startsWith(
                `hero-creation:${unit.entityId}:`,
              )),
        ),
    )
  )
    throw Error(
      "Complete session ledger lost initial policy source identity or null native acceptance",
    );
  result = {
    summary: session.summary,
    ...(staticCatalog === null
      ? {}
      : { selectedStaticCatalog: staticCatalog.describe() }),
    diagnostic,
    compiledPresentationPrograms,
    committedTimingControl: {
      syntheticRecordingClock: true,
      browserExecuted: false,
      gpuSubmission: false,
      cohorts: recordedTimings.cohorts,
    },
    completeCoverage,
    prefixInvalidations,
    prefixPreservations,
    retainedResourceSourceRows: prefixRows.length,
    committedFrames,
    peakLiveMeshes: peak,
    staticMaterials: session.renderer.gpuMaterials.size,
    sourcePolicies: {
      initial: diagnostic.resourcePresentationPolicy?.policy,
      missile: diagnostic.directMissilePresentation?.policy,
    },
    controls: {
      actualSessionFactory: true,
      browserArrayBufferManifestInput: true,
      realBunModuleWorkers: true,
      actualThreeRendererLoader: true,
      completeEventLedger: true,
      cameraWithoutSimulation: true,
      backwardSeek: true,
      sameCommittedWorkerTimingExport: true,
    },
    scope: {
      browserExecuted: false,
      gpuSubmission: false,
      visiblePixels: false,
      nativeMatchAcceptance: null,
      noSuppliedEffectDefinitions: true,
      noSuppliedPerRequestPlacement: true,
      normalPlaybackAcceptance: false,
    },
  };
  if (capturePlayback) {
    playbackCapture = await captureDirectSessionPlayback(session, report);
    const definitions = diagnostic.definitions;
    playbackCapture.depthBiasPrograms = definitions.flatMap((d) =>
      d.components
        .filter((e) => e.depthBiasProgram !== null)
        .map((e) => ({
          definitionId: d.id,
          emitterId: e.id,
          depthBiasProgram: e.depthBiasProgram,
        })),
    );
    playbackCapture.materialBindings = [
      ...session.renderer.gpuMaterials.values(),
    ].map((binding) => structuredClone(binding.prepared));
    if (selectedReconstruction) {
      playbackCapture.decodedReport = {
        path: exported.reportPath,
        sha256: exported.reportSha256,
      };
      playbackCapture.reconstructionControl = {
        path: resolve(cache, "research/selected-reconstruction-control.json"),
        sha256:
          inputs[
            resolve(cache, "research/selected-reconstruction-control.json")
          ],
      };
    }
    if (staticCatalog !== null)
      playbackCapture.selectedStaticCatalog = staticCatalog.describe();
  }
} finally {
  session?.close();
  if (session) await session.client.termination;
  globalThis.fetch = originalFetch;
}
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Session source changed: ${path}`);
const output = `${cache}/research/${controlName}.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-ordinary-direct-session-control",
      ...result,
      requests,
      inputs,
    },
    null,
    2,
  ),
);
if (playbackCapture)
  await Bun.write(
    `${cache}/research/${controlName}-playback.json`,
    JSON.stringify({ ...playbackCapture, inputs }, null, 2),
  );
console.log(
  JSON.stringify({
    output,
    events: result.summary.events,
    definitions: result.summary.definitions,
    staticMaterials: result.staticMaterials,
    committedFrames: result.committedFrames,
    peakLiveMeshes: result.peakLiveMeshes,
    policies: result.sourcePolicies,
    inputs: Object.keys(inputs).length,
    controls: result.controls,
  }),
);
