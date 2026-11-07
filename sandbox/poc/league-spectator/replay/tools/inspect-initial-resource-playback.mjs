import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import {
  loadLatestInitialResourcePrefix,
  INITIAL_RESOURCE_PREFIX_POLICY,
} from "../latest-initial-resource-prefix.mjs";
import { createLatestUnitResources } from "../latest-unit-resources.mjs";
import { createLatestEffectPipeline } from "../latest-effect-pipeline.mjs";
import {
  createLatestWorldPresentation,
  buildLatestDirectEffectEvents,
} from "../latest-world-presentation.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { createLatestDirectEffectPlacement } from "../latest-direct-effect-placement.mjs";
import {
  createLatestViewerPoseAttachmentPlacement,
  VIEWER_POSE_ATTACHMENT_POLICY,
} from "../latest-viewer-pose-attachment.mjs";
import { loadLatestViewerPoseAssets } from "../latest-viewer-pose-assets.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { LatestDirectEffectClient } from "../latest-direct-effect-client.mjs";
import { directDiagnosticDraw } from "./direct-diagnostic-draw.mjs";
import { requestTargetedMissilePresentation } from "../latest-targeted-missile-client.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const includeMissiles = process.argv.includes("--missiles");
const reportedConcurrentNativeControls = process.argv
  .filter((arg) => arg.startsWith("--native-control="))
  .map((arg) => arg.slice("--native-control=".length));
if (reportedConcurrentNativeControls.some((id) => !/^[1-9][0-9]*$/.test(id)))
  throw Error("Explicit native control session IDs must be positive integers");
const inputs = {};
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
    resolve(import.meta.dir, "../latest-direct-effect-session.mjs"),
    resolve(import.meta.dir, "../latest-direct-effect-worker.mjs"),
    resolve(import.meta.dir, "../latest-targeted-missile-worker.mjs"),
  ],
  raw,
);
const exported = await read(
  `${cache}/research/viewer-root-reconstruction.json`,
);
if (
  exported.kind !== "verified-ordinary-reconstruction-diagnostic-export" ||
  exported.runtimePlaybackInput !== false
)
  throw Error("Fresh ordinary-worker diagnostic report required");
for (const [path, digest] of Object.entries(exported.inputs))
  if ((await sha256(await raw(path))) !== digest)
    throw Error(`Stale reconstruction: ${path}`);
if (
  (await sha256(await raw(exported.controlReportPath))) !==
  exported.controlReportSha256
)
  throw Error("Ordinary reconstruction control changed");
const report = exported.report,
  manifestBytes = await load("latest-effects/manifest.json");
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
const initial = await loadLatestInitialResourcePrefix({
  profile,
  load,
  manifestBytes,
  report,
});
const units = await createLatestUnitResources({
  profile,
  resolvers: initial.resolvers,
  packageBytes: await load("latest-unit-resources/package.json"),
});
const pipeline = initial.resolvers.bindTimeline(
  await createLatestEffectPipeline({
    report,
    effectsManifestBytes: manifestBytes,
    quadGpuBytes: await load("latest-complete-quad-gpu/package.json"),
    trailGpuBytes: await load("latest-trail-particles/gpu.json"),
  }),
  report,
);
const scene = await read(`${cache}/public/latest-scene/manifest.json`);
const heightBytes = await load("latest-scene/heights.bin");
const heights = new Float32Array(
  heightBytes.buffer,
  heightBytes.byteOffset,
  heightBytes.byteLength / 4,
);
const terrain = createLatestTerrain(scene, heights),
  definitions = new Map();
const packetPlacement = await createLatestDirectEffectPlacement({
  profile,
  packageBytes: await load("latest-world-descriptor-abi/package.json"),
});
const viewerPoseAssets = await loadLatestViewerPoseAssets({
  profile,
  report,
  scene,
  load,
});
const placement = createLatestViewerPoseAttachmentPlacement({
  profile,
  packetPlacement,
  definitions,
});
let targetedMissiles = null,
  directMissiles = null;
if (includeMissiles) {
  for (const name of ["motion", "controllers", "actors"])
    await load(`decoder-16.21-macos/missile-${name}.json`);
  for (const hero of report.heroes)
    await load(
      `latest-scene/${scene.champions[`${hero.champion.toLowerCase()}/${hero.skinId}`].spellCatalog}`,
    );
  const result = await requestTargetedMissilePresentation({
    family: "all",
    includeDirectMissilePresentation: true,
    report,
    scene,
    heights,
    world: {},
    profile,
    assetBase: "http://127.0.0.1:4180/assets/",
  });
  directMissiles = result.directMissilePresentation;
  delete result.directMissilePresentation;
  targetedMissiles = result;
}
const world = createLatestWorldPresentation({
  report,
  scene,
  terrain,
  initialResourcePrefix: initial.policy,
  effectsManifest: JSON.parse(new TextDecoder().decode(manifestBytes)),
  targetedMissilePresentation: targetedMissiles,
  directMissilePresentation: directMissiles,
  placementResolver: placement.resolve,
  viewerPoseAssets,
});
const events = buildLatestDirectEffectEvents({
  pipeline,
  report,
  world,
  unitResources: units,
  targetedMissilePresentation: targetedMissiles,
});
const prepared = await loadLatestDirectEffectPackage({
  load,
  manifestBytes,
  effectIds: events.flatMap((event) =>
    [event.definitionId, event.auxiliaryCandidateDefinitionId].filter(Boolean),
  ),
});
for (const [id, definition] of prepared.definitions)
  definitions.set(id, definition);
Object.assign(prepared.packages, initial.packages);
prepared.packages.viewerPoseAssets = viewerPoseAssets.serialize();
const payload = {
  profile: prepared.profile,
  packages: prepared.packages,
  contract: { ...prepared.contract, replayHash: report.replaySha256 },
  definitions: [...prepared.definitions.values()],
  events,
  report,
  scene,
  heights,
  world: {
    rootAttachmentPolicy: VIEWER_POSE_ATTACHMENT_POLICY,
    initialResourcePrefixPolicy: INITIAL_RESOURCE_PREFIX_POLICY,
    targetedMissilePresentation: targetedMissiles,
    directMissilePresentation: directMissiles,
  },
};
const camera = includeMissiles
  ? {
      right: [1, 0, 0],
      up: [0, 0.6, -0.8],
      axis: [0, 0.8, 0.6],
      position: [6000, 8000, 12000],
    }
  : {
      right: [1, 0, 0],
      up: [0, 1, 0],
      axis: [0, 0, 1],
      position: [6000, 0, 12000],
    };
const within = (row) => row.time >= 69 && row.time <= 99;
const schedules = [],
  geometry = new Map(),
  snapshots = [];
for (const speed of [1, 4]) {
  const client = new LatestDirectEffectClient(),
    deadline = setTimeout(() => client.close(), 60000);
  try {
    const summary = await client.initialize(payload);
    await client.frame(69, camera);
    let activeFrames = 0,
      peakDraws = 0;
    const timings = [];
    for (let frame = 0; frame <= Math.ceil((30 * 60) / speed); frame++) {
      const packet = await client.frame(
        Math.min(99, 69 + (frame * speed) / 60),
        camera,
      );
      if (packet.draws.length) activeFrames++;
      peakDraws = Math.max(peakDraws, packet.draws.length);
      timings.push({
        time: packet.time,
        simulationMs: packet.metrics.simulationMs,
        worldQueryMs: packet.metrics.worldQueryMs,
        worldQueries: packet.metrics.worldQueries,
        geometryMs: packet.metrics.geometryMs,
        workerOperationMs: packet.metrics.workerOperationMs,
        bookkeepingMs: packet.metrics.bookkeepingMs,
        simulationAndGeometryMs:
          packet.metrics.simulationMs + packet.metrics.geometryMs,
        transport: packet.metrics.transport,
      });
      for (const draw of packet.draws) {
        geometry.set(
          `${draw.sourceEventId}:${draw.generation}:${draw.emitterId}`,
          {
            sourceEventId: draw.sourceEventId,
            generation: draw.generation,
            definitionId: draw.definitionId,
            emitterId: draw.emitterId,
            particles: draw.particleCount ?? draw.particles ?? null,
          },
        );
      }
      if (
        speed === 1 &&
        packet.draws.length &&
        (!includeMissiles || frame % 10 === 0)
      )
        snapshots.push({
          time: packet.time,
          camera,
          draws: packet.draws.map(directDiagnosticDraw),
        });
    }
    const saved = await client.checkpoint(),
      coverage = await client.coverage();
    const redraw = await client.camera({
      right: [0, 0, 1],
      up: [0, 1, 0],
      axis: [-1, 0, 0],
      position: [-6000, 0, 6000],
    });
    if (
      redraw.metrics.simulationStepsAdvanced !== 0 ||
      JSON.stringify(await client.checkpoint()) !== JSON.stringify(saved)
    )
      throw Error("Paused camera regenerated simulation");
    await client.frame(68, camera);
    await client.frame(99, camera);
    if (JSON.stringify(await client.checkpoint()) !== JSON.stringify(saved))
      throw Error("Repeated backward seek changed original event state");
    const percentile = (values, fraction) =>
      [...values].sort((a, b) => a - b)[
        Math.max(0, Math.ceil(values.length * fraction) - 1)
      ];
    const performanceSummary = Object.fromEntries(
      [
        "simulationMs",
        "worldQueryMs",
        "worldQueries",
        "geometryMs",
        "workerOperationMs",
        "bookkeepingMs",
        "simulationAndGeometryMs",
      ].map((key) => [
        key,
        {
          p50: percentile(
            timings.map((row) => row[key]),
            0.5,
          ),
          p95: percentile(
            timings.map((row) => row[key]),
            0.95,
          ),
          max: Math.max(...timings.map((row) => row[key])),
        },
      ]),
    );
    schedules.push({
      speed,
      summary,
      activeFrames,
      peakDraws,
      checkpoint: saved,
      coverage,
      timings,
      performance: performanceSummary,
    });
  } finally {
    clearTimeout(deadline);
    client.close();
    await client.termination;
  }
}
if (
  JSON.stringify(schedules[0].checkpoint) !==
  JSON.stringify(schedules[1].checkpoint)
)
  throw Error("1x/4x schedules changed retained simulation state");
const rows = schedules[0].coverage.rows.filter(within),
  network = rows.filter((row) => row.origin === "network-effect");
const creationStageFields = [
  "resourceResolved",
  "placementResolved",
  "worldInputsResolved",
  "allCompiledComponentInputsResolved",
  "runtimeActivated",
];
for (const row of rows) {
  if (
    creationStageFields.some((field) => typeof row[field] !== "boolean") ||
    !Number.isSafeInteger(row.compiledComponentCount) ||
    row.compiledComponentCount < 0 ||
    !Number.isSafeInteger(row.eligibleComponentCount) ||
    row.eligibleComponentCount < 0 ||
    !Array.isArray(row.initialComponentWorldInputs) ||
    row.initialComponentWorldInputs.length !== row.compiledComponentCount ||
    row.initialComponentWorldInputs.some(
      (c) =>
        !Number.isSafeInteger(c.index) ||
        c.index < 0 ||
        typeof c.resolved !== "boolean",
    ) ||
    new Set(row.initialComponentWorldInputs.map((c) => c.index)).size !==
      row.compiledComponentCount ||
    row.initialComponentWorldInputs.filter((c) => c.resolved).length !==
      row.eligibleComponentCount ||
    row.worldInputsResolved !==
      (row.placementResolved && row.eligibleComponentCount > 0) ||
    (row.placementResolved && !row.resourceResolved) ||
    (row.runtimeActivated && !row.worldInputsResolved) ||
    row.allCompiledComponentInputsResolved !==
      (row.placementResolved &&
        row.compiledComponentCount > 0 &&
        row.eligibleComponentCount === row.compiledComponentCount)
  )
    throw Error(
      `Creation-time component world-input stage contract differs: ${row.id}`,
    );
}
const summarizeStages = (rows) => ({
  decoded: rows.length,
  ...Object.fromEntries(
    creationStageFields.map((field) => [
      field,
      rows.filter((row) => row[field]).length,
    ]),
  ),
  compiledComponents: rows.reduce(
    (sum, row) => sum + row.compiledComponentCount,
    0,
  ),
  eligibleComponents: rows.reduce(
    (sum, row) => sum + row.eligibleComponentCount,
    0,
  ),
  geometryGenerated: rows.filter((row) => row.componentsGenerated.length)
    .length,
});
const grouped = {};
for (const row of network) {
  const refs = row.entityReferences;
  const hero = report.heroes.find((hero) =>
    [refs?.resourceContextEntityId, refs?.lookupA8EntityId].includes(
      hero.entityId,
    ),
  );
  const key = hero?.champion ?? "unresolved-resource-entity";
  const group = (grouped[key] ??= {
    decoded: 0,
    resourceResolved: 0,
    placementResolved: 0,
    worldInputsResolved: 0,
    allCompiledComponentInputsResolved: 0,
    compiledComponents: 0,
    eligibleComponents: 0,
    runtimeActivated: 0,
    geometryGenerated: 0,
    definitions: new Set(),
  });
  for (const stage of ["decoded", ...creationStageFields])
    group[stage] += Number(row[stage]);
  group.compiledComponents += row.compiledComponentCount;
  group.eligibleComponents += row.eligibleComponentCount;
  if (row.componentsGenerated.length) {
    group.geometryGenerated++;
    group.definitions.add(row.definitionId);
  }
}
for (const group of Object.values(grouped))
  group.definitions = [...group.definitions];
const omissions = {};
for (const row of network)
  for (const reason of row.reasons)
    omissions[reason] = (omissions[reason] ?? 0) + 1;
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Input changed during proof: ${path}`);
const output = `${cache}/research/${includeMissiles ? "shared-direct-playback" : "initial-resource-playback"}-worker.json`;
const result = {
  schema: 1,
  kind: "ordinary-decoded-initial-resource-presentation-worker-control",
  policy: initial.policy.metadata,
  comparisonWindow: [69, 99],
  sourceCounts: {
    heroAttacks: report.attacks.filter(
      (r) => within(r) && report.heroes.some((h) => h.entityId === r.entityId),
    ).length,
    heroCasts: report.casts.filter(
      (r) => within(r) && report.heroes.some((h) => h.entityId === r.entityId),
    ).length,
    missileRecords: report.missiles.filter(within).length,
    creationRequests: report.effectCreations.filter(within).length,
  },
  initialQueries: report.heroes.map((hero) => ({
    entityId: hero.entityId,
    champion: hero.champion,
    query: initial.policy.query(hero.entityId, 69),
  })),
  perResourceChampion: grouped,
  stageScope:
    "historical creation-time resolution; geometry generated during sampled playback",
  networkStages: summarizeStages(network),
  allStages: summarizeStages(rows),
  lifecycle: {
    policy: "linked-presentation-emitter-stop-and-tail-v1",
    activatedInstances: rows.filter(
      (r) => r.runtimeActivated && r.lifecycleComponents?.length,
    ).length,
    activatedComponents: rows
      .filter((r) => r.runtimeActivated)
      .reduce((n, r) => n + (r.lifecycleComponents?.length ?? 0), 0),
    translatedRemovalRequests: rows.reduce(
      (n, r) =>
        n +
        (r.translatedRemovalRequests?.filter((v) => v.mode !== null).length ??
          0),
      0,
    ),
    targetedInstances: rows.filter((r) =>
      r.translatedRemovalRequests?.some((v) => v.mode !== null),
    ).length,
    nativeWorldAcceptance: null,
    nativeParentCompletion: null,
  },
  directMissilePreparation: directMissiles
    ? {
        policy: directMissiles.policy,
        traces: directMissiles.traces.length,
        nativeAcceptance: null,
        exactLegacyParticleTimelineAgreement: false,
      }
    : null,
  directMissileFamilyPreparation: world.directMissileFamilyDiagnostics(),
  schedules: schedules.map(({ checkpoint, ...schedule }) => schedule),
  geometry: [...geometry.values()],
  staticMeshPrograms: [...definitions.values()].flatMap((definition) =>
    definition.emitters
      .filter((emitter) => emitter.primitive === "static-mesh")
      .map((emitter) => ({
        definitionId: definition.id,
        emitterId: emitter.index,
        materialKey: emitter.materialKey,
        meshProgram: structuredClone(emitter.meshProgram),
        meshMaterialSelection: structuredClone(emitter.meshMaterialSelection),
      })),
  ),
  rayPrograms: [...definitions.values()].flatMap((definition) =>
    definition.emitters
      .filter((emitter) => emitter.primitive === "ray")
      .map((emitter) => ({
        definitionId: definition.id,
        emitterId: emitter.index,
        materialKey: emitter.materialKey,
        rayProgram: structuredClone(emitter.rayProgram),
        rayMaterialSelection: structuredClone(emitter.rayMaterialSelection),
      })),
  ),
  snapshots,
  depthBiasPrograms: [...definitions.values()].flatMap((definition) =>
    definition.emitters
      .filter((emitter) => emitter.depthBiasProgram)
      .map((emitter) => ({
        definitionId: definition.id,
        emitterId: emitter.index,
        materialKey: emitter.materialKey,
        depthBiasProgram: structuredClone(emitter.depthBiasProgram),
      })),
  ),
  navGroundPrograms: [...definitions.values()].flatMap((definition) =>
    definition.emitters
      .filter((emitter) => emitter.navGroundProgram)
      .map((emitter) => ({
        definitionId: definition.id,
        emitterId: emitter.index,
        materialKey: emitter.materialKey,
        navGroundProgram: structuredClone(emitter.navGroundProgram),
      })),
  ),
  omissions: Object.entries(omissions).sort((a, b) => b[1] - a[1]),
  inputs,
  controls: {
    realBunModuleWorker: true,
    identical1x4xCheckpoint: true,
    cameraWithoutSimulation: true,
    backwardRepeatedSeek: true,
    creationTimeComponentWorldInputStages: true,
  },
  performanceScope: {
    actualComparisonRequests: true,
    syntheticInventory: false,
    sequentialWorkerCalls: true,
    wallClockPacing: false,
    browserFpsEstablished: false,
    isolatedTransferCopyTime: false,
    worldOnlyBaseline: false,
    hostLoadControlled: false,
    worldQueryMsIsSubsetOfSimulationMs: true,
    worldQueryMsIncludesResourcePlacementAndPose: true,
    reportedConcurrentNativeControls,
    concurrentControlLivenessIndependentlyPolled: false,
  },
  scope: {
    actualDecodedReplayRequests: true,
    suppliedEffectDefinitions: false,
    suppliedPerRequestPlacement: false,
    nativeMatchAcceptance: null,
    nativeCacheReadiness: null,
    liveEngineResourceState: null,
    provisionalSeedConvention: true,
    componentsRendered: null,
    visiblePixels: false,
    gpuSubmission: false,
    browserPlaybackObserved: false,
    normalPlaybackAcceptance: false,
  },
};
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    sourceCounts: result.sourceCounts,
    networkStages: result.networkStages,
    allStages: result.allStages,
    directMissilePreparation: result.directMissilePreparation,
    perResourceChampion: grouped,
    schedules: result.schedules.map(
      ({ speed, activeFrames, peakDraws, summary }) => ({
        speed,
        activeFrames,
        peakDraws,
        events: summary.events,
        definitions: summary.definitions,
      }),
    ),
    inputs: Object.keys(inputs).length,
  }),
);
