import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import {
  loadLatestInitialResourcePrefix,
  INITIAL_RESOURCE_PREFIX_POLICY,
} from "../latest-initial-resource-prefix.mjs";
import { loadLatestViewerPoseAssets } from "../latest-viewer-pose-assets.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { createLatestDirectMissileFamilyAdapter } from "../latest-direct-missile-family-adapter.mjs";
import { requestTargetedMissilePresentation } from "../latest-targeted-missile-client.mjs";
import { LatestDirectEffectClient } from "../latest-direct-effect-client.mjs";
import { directDiagnosticDraw } from "./direct-diagnostic-draw.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const raw = async (path) => {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Changed worker input: ${path}`);
  inputs[path] = hash;
  return bytes;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs(
  [
    import.meta.path,
    resolve(import.meta.dir, "../latest-direct-effect-worker.mjs"),
    resolve(import.meta.dir, "../latest-targeted-missile-worker.mjs"),
  ],
  raw,
);
const { report, kind, runtimePlaybackInput } = await read(
  `${cache}/research/viewer-root-reconstruction.json`,
);
if (
  kind !== "verified-ordinary-reconstruction-diagnostic-export" ||
  runtimePlaybackInput !== false ||
  report.endTime !== 99
)
  throw Error("Actual decoded prefix diagnostic fixture required");
// This uses the decoded report as a fixture. All movement and particle programs
// are rebuilt in the actual workers; no historical generated trace is supplied.
const scene = await read(`${cache}/public/latest-scene/manifest.json`),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
const heightBytes = await load("latest-scene/heights.bin"),
  heights = new Float32Array(
    heightBytes.buffer,
    heightBytes.byteOffset,
    heightBytes.byteLength / 4,
  );
for (const name of ["motion", "controllers", "actors"])
  await load(`decoder-16.21-macos/missile-${name}.json`);
for (const hero of report.heroes)
  await load(
    `latest-scene/${scene.champions[`${hero.champion.toLowerCase()}/${hero.skinId}`].spellCatalog}`,
  );
const presentation = await requestTargetedMissilePresentation({
  family: "all",
  includeDirectMissilePresentation: true,
  report,
  scene,
  profile,
  heights,
  world: {},
  assetBase: "http://127.0.0.1:4180/assets/",
});
const directMissilePresentation = presentation.directMissilePresentation;
delete presentation.directMissilePresentation;
const manifestBytes = await load("latest-effects/manifest.json"),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
const selected = presentation.traces.filter(
  (trace) =>
    trace.startTime >= 69 && trace.startTime <= 99 && trace.effectBasisProgram,
);
if (selected.length !== 6)
  throw Error("Six actual comparison-window basis-admitted missiles required");
const adapter = createLatestDirectMissileFamilyAdapter({
  report,
  manifest,
  presentation,
});
const selectedSequences = new Set(selected.map((trace) => trace.sequence));
const events = adapter.events.filter((event) =>
  selectedSequences.has(event.missilePresentation.sequence),
);
const initial = await loadLatestInitialResourcePrefix({
  load,
  profile,
  report,
  manifestBytes,
});
const viewerPoseAssets = await loadLatestViewerPoseAssets({
  load,
  profile,
  report,
  scene,
});
const prepared = await loadLatestDirectEffectPackage({
  load,
  manifestBytes,
  effectIds: events.map((event) => event.definitionId),
});
Object.assign(prepared.packages, initial.packages);
prepared.packages.viewerPoseAssets = viewerPoseAssets.serialize();
const client = new LatestDirectEffectClient();
const camera = {
  right: [1, 0, 0],
  up: [0, 0.6, -0.8],
  axis: [0, 0.8, 0.6],
  position: [6000, 8000, 12000],
};
const packets = [],
  geometry = new Map();
let summary, checkpoint, coverage;
try {
  summary = await client.initialize({
    profile: prepared.profile,
    packages: prepared.packages,
    contract: { ...prepared.contract, replayHash: report.replaySha256 },
    definitions: [...prepared.definitions.values()],
    events,
    report,
    scene,
    heights,
    world: {
      initialResourcePrefixPolicy: INITIAL_RESOURCE_PREFIX_POLICY,
      targetedMissilePresentation: presentation,
      directMissilePresentation,
    },
  });
  for (const time of [
    ...new Set(
      selected.flatMap((trace) => [
        trace.startTime,
        trace.startTime + 0.05,
        trace.startTime + 0.15,
        trace.stopTime + 0.02,
      ]),
    ),
  ].sort((a, b) => a - b)) {
    const packet = await client.frame(time, camera);
    packets.push({ time, draws: packet.draws.map(directDiagnosticDraw) });
    for (const draw of packet.draws)
      geometry.set(`${draw.sourceEventId}:${draw.emitterId}`, {
        sourceEventId: draw.sourceEventId,
        definitionId: draw.definitionId,
        emitterId: draw.emitterId,
      });
  }
  await client.frame(99, camera);
  checkpoint = await client.checkpoint();
  coverage = await client.coverage();
  const redraw = await client.camera({
    ...camera,
    right: [0, 0, 1],
    axis: [-1, 0, 0],
    position: [-6000, 0, 6000],
  });
  if (
    redraw.metrics.simulationStepsAdvanced !== 0 ||
    JSON.stringify(await client.checkpoint()) !== JSON.stringify(checkpoint)
  )
    throw Error("Paused basis redraw advanced retained simulation");
  await client.frame(69, camera);
  await client.frame(99, camera);
  if (JSON.stringify(await client.checkpoint()) !== JSON.stringify(checkpoint))
    throw Error("Repeated seek changed basis-admitted missile state");
} finally {
  client.close();
}
const generated = new Set(
  [...geometry.values()].map((row) => row.sourceEventId),
);
if (generated.size !== 6 || geometry.size !== 6)
  throw Error(
    "All six actual missiles must generate their verified sibling geometry",
  );
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Basis worker input changed: ${path}`);
const result = {
  schema: 1,
  kind: "actual-fixed-time-basis-worker-control",
  inputs,
  summary,
  geometry: [...geometry.values()],
  packets,
  coverage,
  counts: {
    selectedMissiles: selected.length,
    events: events.length,
    generatedMissiles: generated.size,
    generatedComponents: geometry.size,
  },
  controls: {
    actualMovementWorker: true,
    actualParticleWorker: true,
    pauseWithoutSimulation: true,
    repeatedBackwardSeek: true,
  },
  scope: {
    actualDecodedReplayRequests: true,
    sourceBoneGuessed: false,
    suppliedHistoricalMotionTrace: false,
    gpuSubmission: false,
    browserPlaybackObserved: false,
    nativeMatchAcceptance: null,
    completeEffectFidelity: false,
  },
};
const output = `${cache}/research/fixed-time-basis-worker.json`;
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    counts: result.counts,
    inputs: Object.keys(inputs).length,
  }),
);
