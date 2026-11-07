import { relative, resolve } from "node:path";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { createLatestEffectPipeline } from "../latest-effect-pipeline.mjs";
import { createLatestEffectContexts } from "../latest-effect-contexts.mjs";
import { createLatestEffectResolvers } from "../latest-effect-resolvers.mjs";
import { createLatestUnitResources } from "../latest-unit-resources.mjs";
import { createLatestDirectEffectPlacement } from "../latest-direct-effect-placement.mjs";
import {
  buildLatestDirectEffectEvents,
  createLatestWorldPresentation,
} from "../latest-world-presentation.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { LatestDirectEffectRuntime } from "../latest-direct-effect-runtime.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { LatestDirectEffectClient } from "../latest-direct-effect-client.mjs";
import { withDirectPresentationOrdinals } from "./direct-effect-transport-fixture.mjs";
import { pathToFileURL } from "node:url";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const sourceRoot = resolve(import.meta.dir, ".."),
  producerHashes = new Map();
await captureDirectSourceInputs(
  // Workers are constructed by URL rather than a static client import.
  [import.meta.path, resolve(sourceRoot, "latest-direct-effect-worker.mjs")],
  async (path) => {
    const bytes = await Bun.file(path).bytes();
    producerHashes.set(path, await sha256(bytes));
    return bytes;
  },
);
const load = async (p) =>
  new Uint8Array(await Bun.file(`${cache}/public/${p}`).arrayBuffer());
const read = async (p) => JSON.parse(new TextDecoder().decode(await load(p)));
let report = await Bun.file(
  `${cache}/research/latest-semantics-effects.json`,
).json();
if (
  [
    ...report.missiles,
    ...report.missileEvents,
    ...report.attacks,
    ...report.casts,
    ...report.movement,
    ...report.lifecycle,
    ...report.worldEvents,
  ].some((r) => r.transportSequence === undefined) ||
  report.heroes.some((hero) => hero.provenance.transportSequence === undefined)
) {
  if (!process.argv[3])
    throw Error(
      "Stale comparison provenance: pass the original replay as the second argument",
    );
  const { decompress } = await import(
    pathToFileURL(`${cache}/public/vendor/fzstd.mjs`).href
  );
  report = await withDirectPresentationOrdinals(
    report,
    await Bun.file(process.argv[3]).bytes(),
    decompress,
  );
}
const manifestBytes = await load("latest-effects/manifest.json");
const profile = await read("decoder-16.21-macos/profile.json");
const contexts = await createLatestEffectContexts({
  profile,
  packageBytes: await load("latest-effect-contexts/package.json"),
  effectsManifestBytes: manifestBytes,
});
const resolvers = await createLatestEffectResolvers({
  profile,
  builtinContextPackageBytes: await load(
    "latest-builtin-resource-contexts/package.json",
  ),
  packageBytes: await load("latest-effect-resolvers/package.json"),
  effectsManifestBytes: manifestBytes,
  contexts,
});
const pipeline = resolvers.bindTimeline(
  await createLatestEffectPipeline({
    report,
    effectsManifestBytes: manifestBytes,
    quadGpuBytes: await load("latest-complete-quad-gpu/package.json"),
    trailGpuBytes: await load("latest-trail-particles/gpu.json"),
  }),
  report,
);
const unitResources = await createLatestUnitResources({
  profile,
  resolvers,
  packageBytes: await load("latest-unit-resources/package.json"),
});
const placementPolicy = await createLatestDirectEffectPlacement({
  profile,
  packageBytes: await load("latest-world-descriptor-abi/package.json"),
});
const scene = await read("latest-scene/manifest.json");
const heights = await load("latest-scene/heights.bin");
const terrain = createLatestTerrain(
  scene,
  new Float32Array(heights.buffer, heights.byteOffset, heights.byteLength / 4),
);
const world = createLatestWorldPresentation({
  report,
  scene,
  terrain,
  placementResolver: placementPolicy.resolve,
});
const events = buildLatestDirectEffectEvents({
  pipeline,
  report,
  world,
  unitResources,
});
const prepared = await loadLatestDirectEffectPackage({
  load,
  manifestBytes,
  effectIds: events.flatMap((event) =>
    [event.definitionId, event.auxiliaryCandidateDefinitionId].filter(Boolean),
  ),
});
const runtime = new LatestDirectEffectRuntime({
  ...prepared.contract,
  replayHash: report.replaySha256,
  definitions: prepared.definitions,
  events,
  world,
  kernels: prepared.kernels,
});
// Explicit diagnostic view only; this is neither a replay-camera observation
// nor an inferred effect placement. Ray geometry requires the view position.
const camera = { right: [1, 0, 0], up: [0, 1, 0], position: [300, 900, 1200] };
const samples = [],
  counts = {};
runtime.advanceTo(69);
for (let frame = 0; frame <= 1800; frame++) {
  runtime.advanceTo(69 + frame / 60);
  const packet = runtime.generateDraws(camera);
  samples.push({
    time: packet.time,
    ...packet.metrics,
    draws: packet.draws.length,
  });
}
const coverage = runtime.coverage({ includeRows: true });
for (const row of coverage.rows.filter((r) => r.time >= 69 && r.time <= 99))
  for (const reason of row.reasons) counts[reason] = (counts[reason] ?? 0) + 1;
const client = new LatestDirectEffectClient();
let workerChecks;
const deadline = setTimeout(() => client.close(), 30000);
try {
  const summary = await client.initialize({
    profile: prepared.profile,
    packages: prepared.packages,
    contract: { ...prepared.contract, replayHash: report.replaySha256 },
    definitions: [...prepared.definitions.values()],
    events,
    report,
    scene,
    heights: new Float32Array(
      heights.buffer,
      heights.byteOffset,
      heights.byteLength / 4,
    ),
    world: {},
  });
  const forward = await client.frame(99, camera);
  const saved = await client.checkpoint();
  const redraw = await client.camera({ ...camera, right: [0, 0, 1] });
  if (
    redraw.metrics.simulationMs !== 0 ||
    redraw.metrics.simulationStepsAdvanced !== 0
  )
    throw Error(
      "Camera-only worker metrics include simulation from a previous request",
    );
  const afterCamera = await client.checkpoint();
  if (JSON.stringify(saved) !== JSON.stringify(afterCamera))
    throw Error("Camera redraw changed direct worker state");
  await client.frame(69, camera);
  const repeated = await client.frame(99, camera);
  if (JSON.stringify(forward.coverage) !== JSON.stringify(repeated.coverage))
    throw Error("Direct worker seek changed request coverage");
  workerChecks = {
    summary,
    realBunModuleWorker: true,
    repeatedSeek: true,
    cameraWithoutSimulation: true,
    perFrameGuestInstructions: 0,
  };
} finally {
  clearTimeout(deadline);
  client.close();
  await client.termination;
}
const output = {
  schema: 1,
  kind: "direct-effect-admission-and-local-cpu-evidence",
  contract: runtime.contract,
  comparisonWindow: [69, 99],
  sourceCounts: {
    heroAttacks: report.attacks.filter(
      (e) =>
        e.time >= 69 &&
        e.time <= 99 &&
        report.heroes.some((h) => h.entityId === e.entityId),
    ).length,
    heroCasts: report.casts.filter(
      (e) =>
        e.time >= 69 &&
        e.time <= 99 &&
        report.heroes.some((h) => h.entityId === e.entityId),
    ).length,
    missileRecords: report.missiles.filter((e) => e.time >= 69 && e.time <= 99)
      .length,
    creationRequests: report.effectCreations.filter(
      (e) => e.time >= 69 && e.time <= 99,
    ).length,
  },
  definitions: [...prepared.definitions.values()].map((d) => ({
    id: d.id,
    programVersion: d.programVersion,
    systemIdentity: d.systemIdentity,
    systemFlags: d.systemFlags,
    systemAudio: d.systemAudio,
    systemOmissions: d.systemOmissions,
    childResourceAncestryRequired: d.childResourceAncestryRequired,
    supported: d.emitters.map((e) => e.index),
    components: d.emitters.map((e) => ({
      id: e.index,
      placementRequirements: e.placementRequirements,
      materialPolicy: e.materialPolicy ?? null,
      legacyOffsetProgram: e.legacyOffsetProgram ?? null,
      spriteProgram: e.spriteProgram ?? null,
      depthBiasProgram: e.depthBiasProgram ?? null,
      paletteProgram: e.paletteProgram ?? null,
      paletteTexture: e.paletteTexture ?? null,
      rayProgram: e.rayProgram ?? null,
      rayPaletteTexture: e.rayPaletteTexture ?? null,
      rayMaterialSelection: e.rayMaterialSelection ?? null,
      lifecycleProgram: e.lifecycleProgram ?? null,
      singleResourceProgram: e.singleResourceProgram ?? null,
      omissions: [...(e.omissions ?? [])],
    })),
    unsupported: d.unsupported,
    blockers: d.blockers,
  })),
  coverage,
  omissions: Object.entries(counts).sort((a, b) => b[1] - a[1]),
  samples,
  workerChecks,
  scope: {
    browserPlayback: false,
    worldOnlyBaseline: false,
    gpuSubmission: false,
    visiblePixelCoverage: false,
    normalPlaybackReplacementAccepted: false,
    simulationGuestInstructions: 0,
    suppliedDiagnosticCamera: camera,
  },
  inputs: {
    effectsManifestSha256: await sha256(manifestBytes),
    producers: Object.fromEntries(
      [...producerHashes]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, digest]) => [
          relative(sourceRoot, path).replaceAll("\\", "/"),
          digest,
        ]),
    ),
  },
};
const outputPath = `${cache}/research/direct-effects.json`;
for (const [path, digest] of producerHashes)
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Admission producer changed during execution: ${path}`);
await Bun.write(outputPath, JSON.stringify(output, null, 2));
console.log(
  JSON.stringify(
    {
      outputPath,
      sourceCounts: output.sourceCounts,
      compiledDefinitions: prepared.definitions.size,
      definitionsWithComponents: output.definitions.filter(
        (d) => d.supported.length,
      ).length,
      coverage: { ...coverage, rows: undefined },
      omissions: output.omissions.slice(0, 12),
    },
    null,
    2,
  ),
);
