import { resolve } from "node:path";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { LatestDirectEffectClient } from "../latest-direct-effect-client.mjs";
import { LatestDirectEffectPresentation } from "../latest-direct-effect-presentation.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { projectDirectEmitterControl } from "./direct-emitter-control-projection.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const inputs = {};
const raw = async (path) => {
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return bytes;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const load = (path) => raw(`${cache}/public/${path}`);
const admission = await read(`${cache}/research/direct-effects.json`);
for (const [file, expected] of Object.entries(admission.inputs.producers))
  if (
    (await sha256(await raw(resolve(import.meta.dir, "..", file)))) !== expected
  )
    throw Error(`Stale direct admission producer: ${file}`);
for (const file of [
  "latest-direct-effect-presentation.mjs",
  "latest-direct-effect-presentation.test.mjs",
  "latest-direct-effect-session.mjs",
  "latest-direct-effect-client.mjs",
  "latest-particle-worker-client.mjs",
  "latest-viewer.mjs",
  "tools/inspect-direct-presentation.mjs",
])
  await raw(resolve(import.meta.dir, "..", file));
const manifestBytes = await load("latest-effects/manifest.json");
const prepared = await loadLatestDirectEffectPackage({
  load,
  manifestBytes,
  effectIds: admission.definitions
    .filter((d) => d.supported.length)
    .map((d) => d.id),
});
// Explicit active controls isolate worker handoff from match eligibility. These
// supplied positions/seeds and child-free root projections never enter the
// viewer session. Preserve all selected emitters in the multi-emitter handoff.
const definitions = [...prepared.definitions.values()].map((d) => {
  const projections = d.emitters.map((e) => projectDirectEmitterControl(d, e));
  if (!projections.length)
    throw Error("Presentation control requires emitters");
  return {
    ...projections[0],
    emitters: projections.flatMap((p) => p.emitters),
  };
});
const events = definitions.flatMap((definition, ordinal) => [
  {
    id: `presentation-control:${ordinal}`,
    kind: "create",
    origin: "animation",
    entityId: ordinal + 1,
    definitionId: definition.id,
    time: 0,
    transportSequence: ordinal,
    entryOrder: 0,
    seedHex: ordinal.toString(16).padStart(16, "0"),
    placement: {
      kind: "explicit-world",
      position: [ordinal * 250, 0, 0],
      basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      boundObjectSize: 0,
      boundObjectSizeStatus: "supplied-native-component-control-zero",
    },
  },
]);
const report = await read(`${cache}/research/latest-semantics-effects.json`);
const scene = await read(`${cache}/public/latest-scene/manifest.json`);
const heightBytes = await load("latest-scene/heights.bin");
const heights = new Float32Array(
  heightBytes.buffer,
  heightBytes.byteOffset,
  heightBytes.byteLength / 4,
);
const camera = { right: [1, 0, 0], up: [0, 1, 0], position: [300, 900, 1200] };
const rotated = {
  right: [0, 0, -1],
  up: [0, 1, 0],
  position: [1200, 900, 300],
};
const client = new LatestDirectEffectClient();
const presentation = new LatestDirectEffectPresentation(client, {
  maximumAdvances: 4,
});
const deadline = setTimeout(() => {
  presentation.close();
  client.close();
}, 60000);
let result;
try {
  await client.initialize({
    compilationMode: "diagnostic-child-free-component-projection-v1",
    profile: prepared.profile,
    // The isolated roots above carry no original parent child capability.
    packages: { ...prepared.packages, childSiblingDefinitions: [] },
    contract: { ...prepared.contract, replayHash: report.replaySha256 },
    definitions,
    events,
    report,
    scene,
    heights,
    world: {},
  });
  const initial = await presentation.sample(0, camera);
  if (
    initial.operation !== "advance" ||
    initial.time !== 0 ||
    !initial.presentable
  )
    throw Error("First zero-time sample must advance initial events");
  const advancing = presentation.sample(0.25, camera);
  const superseded = presentation.camera(camera);
  const redraw = presentation.camera(rotated);
  const [first, oldView, currentView] = await Promise.all([
    advancing,
    superseded,
    redraw,
  ]);
  if (
    first.status !== "ready" ||
    first.presentable ||
    oldView.status !== "superseded" ||
    currentView.status !== "ready" ||
    !currentView.presentable ||
    presentation.isCurrent(first) ||
    !presentation.isCurrent(currentView) ||
    currentView.packet.metrics.simulationStepsAdvanced !== 0 ||
    currentView.packet.metrics.simulationMs !== 0 ||
    !currentView.packet.draws.length
  )
    throw Error("Actual worker presentation/camera ownership differs");
  const before = await client.checkpoint();
  const cameraOnly = await presentation.sample(0.25, camera);
  const after = await client.checkpoint();
  if (
    JSON.stringify(before) !== JSON.stringify(after) ||
    cameraOnly.operation !== "camera" ||
    !cameraOnly.presentable ||
    presentation.isCurrent(currentView) ||
    !presentation.isCurrent(cameraOnly)
  )
    throw Error("Camera-only draw mutated simulation/RNG/checkpoint state");
  const pending = [0.5, 0.125, 0.125, 0.75].map((time) =>
    presentation.advance(time, camera),
  );
  const rejected = await presentation.advance(0.9, camera).then(
    () => null,
    (error) => error,
  );
  if (rejected?.name !== "DirectEffectBackpressureError")
    throw Error("Actual worker queue must reject excess advance explicitly");
  const ordered = await Promise.all(pending);
  if (
    ordered.some(
      (entry, index) =>
        entry.status !== "ready" ||
        entry.time !== [0.5, 0.125, 0.125, 0.75][index],
    ) ||
    ordered.filter((entry) => entry.presentable).length !== 1 ||
    !ordered.at(-1).presentable
  )
    throw Error("Actual worker accepted advance ordering differs");
  result = {
    acceptedAdvances: 6,
    cameraOnlyDraws: 2,
    supersededUnstartedCameraDraws: 1,
    initialZeroTimeAdvanced: true,
    excessAdvanceRejectedExplicitly: true,
    liveResultOwnershipVerified: true,
    returnedTimes: ordered.map((entry) => entry.time),
    cameraCheckpointUnchanged: true,
    activeDrawComponents: currentView.packet.draws.length,
    emulatedSimulationInstructions: 0,
  };
} finally {
  clearTimeout(deadline);
  presentation.close();
  client.close();
  await client.termination;
}
for (const [path, expected] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== expected)
    throw Error(`Presentation verification input changed: ${path}`);
const output = `${cache}/research/direct-presentation-worker-control.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      build: prepared.profile.clientVersion,
      protocol: prepared.profile.protocolDigest,
      result,
      inputs,
      scope: {
        actualModuleWorker: true,
        suppliedPositionsAndSeeds: true,
        isolatedAdmittedComponents: true,
        normalPlaybackEnabled: false,
        actualMatchActivationProven: false,
        browserGpuSubmissionVerified: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    result,
    inputFingerprintsVerified: Object.keys(inputs).length,
  }),
);
