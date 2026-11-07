import { resolve } from "node:path";
import { createLatestDirectEffectPlacement } from "../latest-direct-effect-placement.mjs";
import {
  createLatestViewerRootAttachmentPlacement,
  VIEWER_ROOT_ATTACHMENT_POLICY,
} from "../latest-viewer-root-attachment.mjs";
import { createLatestWorldPresentation } from "../latest-world-presentation.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { LatestDirectEffectClient } from "../latest-direct-effect-client.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const inputs = {};
const bytes = async (path) => {
  const data = await Bun.file(path).bytes(),
    digest = await sha256(data);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Input changed: ${path}`);
  inputs[path] = digest;
  return data;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await bytes(path)));
const load = (path) => bytes(`${cache}/public/${path}`);
await captureDirectSourceInputs(
  [
    import.meta.path,
    resolve(import.meta.dir, "../latest-direct-effect-session.mjs"),
    resolve(import.meta.dir, "../latest-viewer.mjs"),
  ],
  bytes,
);
const reconstruction = await read(
  `${cache}/research/viewer-root-reconstruction.json`,
);
if (
  reconstruction.schema !== 1 ||
  reconstruction.kind !==
    "verified-ordinary-reconstruction-diagnostic-export" ||
  reconstruction.runtimePlaybackInput !== false ||
  !reconstruction.report ||
  !reconstruction.inputs ||
  typeof reconstruction.controlReportPath !== "string"
)
  throw Error("Verified current ordinary reconstruction export required");
for (const [path, digest] of Object.entries(reconstruction.inputs))
  if ((await sha256(await bytes(path))) !== digest)
    throw Error(`Reconstruction source changed: ${path}`);
if (
  (await sha256(await bytes(reconstruction.controlReportPath))) !==
  reconstruction.controlReportSha256
)
  throw Error("Reconstruction control report changed");
const report = reconstruction.report;
const scene = await read(`${cache}/public/latest-scene/manifest.json`);
const heightsBytes = await load("latest-scene/heights.bin");
const heights = new Float32Array(
  heightsBytes.buffer,
  heightsBytes.byteOffset,
  heightsBytes.byteLength / 4,
);
const terrain = createLatestTerrain(scene, heights);
const manifestBytes = await load("latest-effects/manifest.json");
const prepared = await loadLatestDirectEffectPackage({
  load,
  manifestBytes,
  effectIds: ["champions/maokai/3/ce27373e"],
});
const definition = [...prepared.definitions.values()][0];
if (
  definition.blockers.length ||
  !definition.emitters.length ||
  definition.emitters.some(
    (e) => !["camera-quad", "arbitrary-quad"].includes(e.primitive),
  )
)
  throw Error("Original compiled ordinary quad control required");
const placement = createLatestViewerRootAttachmentPlacement({
  profile: prepared.profile,
  packetPlacement: await createLatestDirectEffectPlacement({
    profile: prepared.profile,
    packageBytes: prepared.packages.placement,
  }),
  definitions: prepared.definitions,
});
const world = createLatestWorldPresentation({
  report,
  scene,
  terrain,
  placementResolver: placement.resolve,
});
// Match canonical create-request ordering in latest-effect-pipeline: the
// descriptor index is global across decoded creation groups and packets.
const window = report.effectDescriptors
  .map((descriptor, entryOrder) => ({ descriptor, entryOrder }))
  .filter(({ descriptor }) => descriptor.time >= 69 && descriptor.time <= 99);
const probes = window.map(({ descriptor, entryOrder }) => {
  const event = { descriptor, definitionId: definition.id };
  const cursor = {
    transportSequence: descriptor.transportSequence,
    entryOrder,
  };
  const result = world.placement(event, descriptor.time, cursor);
  return { descriptor, cursor, result };
});
const admitted = probes.filter(
  (p) => p.descriptor.attachmentEntityId && p.result.resolved,
);
if (!admitted.length)
  throw Error(
    `Actual decoded root inputs did not exercise viewer policy: ${JSON.stringify(
      probes
        .filter((p) => p.descriptor.attachmentEntityId)
        .reduce((counts, p) => {
          for (const reason of p.result.reasons)
            counts[reason] = (counts[reason] ?? 0) + 1;
          return counts;
        }, {}),
    )}`,
  );
const source = admitted[0];
const event = {
  id: "viewer-root-worker-supplied-activation-control",
  origin: "network-effect",
  kind: "create",
  entityId: source.descriptor.entityId,
  definitionId: definition.id,
  descriptor: source.descriptor,
  time: source.descriptor.time,
  transportSequence: source.descriptor.transportSequence,
  entryOrder: source.cursor.entryOrder,
  seedHex: "0000000000003039",
};
const payload = {
  profile: prepared.profile,
  packages: prepared.packages,
  contract: { ...prepared.contract, replayHash: report.replaySha256 },
  definitions: [definition],
  events: [event],
  report,
  scene,
  heights,
  world: { rootAttachmentPolicy: VIEWER_ROOT_ATTACHMENT_POLICY },
};
const client = new LatestDirectEffectClient();
const camera = {
  position: [12000, 12000, 0],
  right: [1, 0, 0],
  up: [0, 0, 1],
  axis: [0, 1, 0],
};
const frames = [];
let activeFrames = 0;
try {
  const summary = await client.initialize(payload);
  if (
    summary.emulatedInstructions !== 0 ||
    summary.placementPolicy.attachmentPolicy !== VIEWER_ROOT_ATTACHMENT_POLICY
  )
    throw Error("Worker did not declare direct viewer-root policy");
  let checkpoint;
  for (const offset of [0, 0.1, 0.25, 0.5]) {
    const time = event.time + offset;
    const packet = await client.frame(time, camera);
    const state = await client.checkpoint();
    const instance = state.instances[0]?.[1];
    const inputTime = Math.max(event.time, state.tick / 60);
    const expected = world.viewerRoot(
      source.descriptor.attachmentEntityId,
      inputTime,
      inputTime === event.time ? source.cursor : null,
    );
    if (
      !instance ||
      JSON.stringify(Array.from(instance.position)) !==
        JSON.stringify(expected.position) ||
      JSON.stringify(Array.from(instance.basis)) !==
        JSON.stringify(source.result.basis) ||
      instance.placementEvidence.policy !== VIEWER_ROOT_ATTACHMENT_POLICY ||
      instance.placementEvidence.rootInput.nativeAcceptance !== null
    )
      throw Error("Direct worker and visible-actor root diverged");
    const particles = packet.draws.reduce((n, d) => n + d.particleCount, 0);
    activeFrames += particles > 0;
    frames.push({
      time: state.time,
      simulationRootInputTime: inputTime,
      position: Array.from(instance.position),
      basis: Array.from(instance.basis),
      particles,
      creationRootInput: instance.placementEvidence.rootInput,
    });
    if (offset === 0.1) checkpoint = state;
  }
  await client.restore(checkpoint);
  const restored = await client.checkpoint();
  if (JSON.stringify(restored) !== JSON.stringify(checkpoint))
    throw Error("Viewer-root checkpoint restore differs");
  const redraw = await client.camera({
    ...camera,
    position: [0, 12000, 12000],
  });
  if (
    redraw.time !== checkpoint.time ||
    JSON.stringify(await client.checkpoint()) !== JSON.stringify(checkpoint)
  )
    throw Error("Viewer-root camera change advanced simulation");
  if (!activeFrames)
    throw Error("Supplied activation control produced no particles");
  await client.frame(event.time - 0.01, camera);
  if ((await client.checkpoint()).instances.length !== 0)
    throw Error("Backward seek retained the future attached instance");
  await client.frame(checkpoint.time, camera);
  if (JSON.stringify(await client.checkpoint()) !== JSON.stringify(checkpoint))
    throw Error("Repeated forward seek changed the attached instance");
} finally {
  client.close();
}
const reasonCounts = {};
for (const p of probes.filter(
  (p) => p.descriptor.attachmentEntityId && !p.result.resolved,
))
  for (const reason of p.result.reasons)
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Input drift: ${path}`);
const output = `${cache}/research/viewer-root-attachment-control.json`;
await Bun.write(
  output,
  JSON.stringify({
    schema: 1,
    kind: "declared-viewer-root-attachment-control",
    policy: VIEWER_ROOT_ATTACHMENT_POLICY,
    inputs,
    actualDecodedDescriptors: window.length,
    descriptorsWithViewerRootInput: admitted.length,
    sourceEntityIds: [
      ...new Set(admitted.map((p) => p.descriptor.attachmentEntityId)),
    ],
    omittedAttachedReasons: reasonCounts,
    frames,
    activeFrames,
    scope: {
      suppliedActivationDefinitionAndSeed: true,
      actualDecodedWorldTracks: true,
      realDirectModuleWorker: true,
      cameraIndependentSimulation: true,
      checkpointRestore: true,
      nativeResourceBindingsEstablished: false,
      nativePlacementParity: null,
      actualMatchRuntimeActivationEstablished: false,
      browserVisualAcceptance: false,
    },
  }),
);
console.log(
  JSON.stringify({
    output,
    descriptorsWithViewerRootInput: admitted.length,
    activeFrames,
    fingerprints: Object.keys(inputs).length,
  }),
);
