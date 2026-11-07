import { resolve } from "node:path";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import {
  LatestDirectEffectRuntime,
  directDrawTransfers,
} from "../latest-direct-effect-runtime.mjs";
import { LatestDirectEffectClient } from "../latest-direct-effect-client.mjs";
import { createLatestWorldPresentation } from "../latest-world-presentation.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { projectDirectEmitterControl } from "./direct-emitter-control-projection.mjs";

// Exercise active particles across the actual module-worker boundary. Definition
// activation and positions are supplied controls, never inferred match coverage.
const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const trailOnly = process.argv.includes("--trail");
const inputs = {};
const bytes = async (path) => {
  const raw = await Bun.file(path).bytes();
  const digest = await sha256(raw);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Input changed during worker verification: ${path}`);
  inputs[path] = digest;
  return raw;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await bytes(path)));
const load = (path) => bytes(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], bytes);
const admission = trailOnly
  ? null
  : await read(`${cache}/research/direct-effects.json`);
if (admission) {
  for (const [file, expected] of Object.entries(admission.inputs.producers)) {
    const path = resolve(import.meta.dir, "..", file);
    if ((await sha256(await bytes(path))) !== expected)
      throw Error(`Stale direct admission producer: ${file}`);
  }
}
const manifestBytes = await load("latest-effects/manifest.json");
if (
  admission &&
  (await sha256(manifestBytes)) !== admission.inputs.effectsManifestSha256
)
  throw Error("Worker control effect manifest differs from admission");
const selected = trailOnly
  ? [{ id: "champions/vladimir/39/9fbafd14" }]
  : admission.definitions.filter((d) => d.supported.length);
const prepared = await loadLatestDirectEffectPackage({
  load,
  manifestBytes,
  effectIds: selected.map((d) => d.id),
});
// This is a transport control, not parent activation. Validate every retained
// emitter through the same explicit child-free projection as numeric controls;
// regroup them solely to exercise the original multi-emitter handoff.
const definitions = [...prepared.definitions.values()].map((d) => {
  const emitters = trailOnly
    ? d.emitters.filter((e) => e.primitive === "camera-trail")
    : d.emitters;
  const projections = emitters.map((e) => projectDirectEmitterControl(d, e));
  if (!projections.length) throw Error("Worker control requires emitters");
  return {
    ...projections[0],
    emitters: projections.flatMap((p) => p.emitters),
  };
});
for (const definition of definitions) {
  if (trailOnly) {
    if (definition.emitters.length !== 3)
      throw Error("All three CameraTrail regressions required");
    continue;
  }
  const expected = selected.find((d) => d.id === definition.id).supported;
  if (
    JSON.stringify(definition.emitters.map((e) => e.index)) !==
    JSON.stringify(expected)
  )
    throw Error(`Worker control component admission changed: ${definition.id}`);
}
if (!definitions.length)
  throw Error("Active worker control requires components");
const events = definitions
  .flatMap((definition, ordinal) => [
    {
      id: `worker-control:${ordinal}`,
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
    {
      id: `worker-control-stop:${ordinal}`,
      kind: "stop",
      origin: "animation",
      entityId: ordinal + 1,
      sourceEventId: `worker-control:${ordinal}`,
      time: 0.75,
      transportSequence: definitions.length + ordinal,
      entryOrder: 0,
    },
  ])
  .sort((a, b) => a.time - b.time || a.transportSequence - b.transportSequence);
const report = await read(`${cache}/research/latest-semantics-effects.json`);
const scene = JSON.parse(
  new TextDecoder().decode(await load("latest-scene/manifest.json")),
);
const heightBytes = await load("latest-scene/heights.bin");
const heights = new Float32Array(
  heightBytes.buffer,
  heightBytes.byteOffset,
  heightBytes.byteLength / 4,
);
const contract = { ...prepared.contract, replayHash: report.replaySha256 };
const payload = {
  compilationMode: "diagnostic-child-free-component-projection-v1",
  profile: prepared.profile,
  // No child capability is transported: every selected emitter above is an
  // isolated child-free control, rather than an admitted original parent.
  packages: { ...prepared.packages, childSiblingDefinitions: [] },
  definitions,
  events,
  report,
  scene,
  heights,
  contract,
  world: {},
};
const runtime = new LatestDirectEffectRuntime({
  ...contract,
  definitions: new Map(definitions.map((d) => [d.id, d])),
  events,
  world: createLatestWorldPresentation({
    report,
    scene,
    terrain: createLatestTerrain(scene, heights),
  }),
  kernels: prepared.kernels,
});
const cameras = [
  {
    right: [1, 0, 0],
    up: [0, 1, 0],
    axis: [0, 0, 1],
    position: [300, 900, 1200],
  },
  {
    right: [0, 0, -1],
    up: [0, 1, 0],
    axis: [1, 0, 0],
    position: [1200, 900, 300],
  },
  {
    right: [1, 0, 0],
    up: [0, 0, 1],
    axis: [0, 1, 0],
    position: [300, 1200, 900],
  },
];
const encode = (value) => new TextEncoder().encode(JSON.stringify(value));
const digest = (value) => sha256(encode(value));
const drawValue = (packet) =>
  packet.draws.map((draw) =>
    Object.fromEntries(
      Object.entries(draw).map(([key, value]) => [
        key,
        ArrayBuffer.isView(value) ? Array.from(value) : value,
      ]),
    ),
  );
let frames = 0,
  cameraRedraws = 0,
  activeFrames = 0,
  peakParticles = 0,
  packedParticleUVDraws = 0;
const generatedComponents = new Set();
const snapshots = [];
for (const file of [
  "latest-direct-effect-client.mjs",
  "latest-particle-worker-client.mjs",
  "latest-direct-effect-draw.mjs",
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
  "latest-direct-effect-worker.mjs",
  "latest-direct-effect-definition.mjs",
  "latest-direct-effect-birth.mjs",
  "latest-direct-effect-trail.mjs",
  "latest-direct-effect-trail-math.mjs",
  "latest-direct-effect-trail-table.mjs",
  "latest-direct-effect-math.mjs",
  "latest-direct-effect-camera.mjs",
  "tools/inspect-direct-worker-checkpoints.mjs",
])
  await bytes(resolve(import.meta.dir, "..", file));
const client = new LatestDirectEffectClient();
const deadline = setTimeout(() => client.close(), 60000);
const checkDraw = async (actual, expected, label) => {
  const transport = actual.metrics.transport;
  const buffers = new Set(directDrawTransfers(actual));
  const bufferBytes = [...buffers].reduce(
    (n, buffer) => n + buffer.byteLength,
    0,
  );
  if (
    !transport ||
    transport.drawBufferBytes !== bufferBytes ||
    actual.metrics.transferredBytes !== bufferBytes ||
    transport.deliveryIncludesScheduling !== true ||
    ![
      transport.startedAtEpochMs,
      transport.receivedAtEpochMs,
      transport.processingAtEpochMs,
      transport.replyReadyAtEpochMs,
      transport.clientReceivedAtEpochMs,
      transport.roundTripMs,
      transport.requestDeliveryMs,
      transport.workerQueueMs,
      transport.replyDeliveryMs,
    ].every(Number.isFinite) ||
    transport.roundTripMs < 0 ||
    transport.workerQueueMs < 0
  )
    throw Error(
      `Worker transport measurements differ from owned buffers: ${label}`,
    );
  if (
    actual.time !== expected.time ||
    JSON.stringify(drawValue(actual)) !== JSON.stringify(drawValue(expected))
  )
    throw Error(`Worker geometry differs from synchronous runtime: ${label}`);
  const particles = actual.draws.reduce((n, draw) => n + draw.particleCount, 0);
  activeFrames += particles > 0;
  peakParticles = Math.max(peakParticles, particles);
  for (const draw of actual.draws) {
    if (draw.positions !== undefined) {
      if (
        !(draw.particleUV instanceof Uint16Array) ||
        draw.particleUV.length !== draw.particleCount * 3 ||
        !buffers.has(draw.particleUV.buffer)
      )
        throw Error(
          `Owned transferred quad particle UV halves required: ${label}`,
        );
      packedParticleUVDraws++;
    } else if (draw.particleUV !== undefined)
      throw Error(
        `Packed primitives cannot acquire a quad UV stream: ${label}`,
      );
    generatedComponents.add(`${draw.definitionId}:${draw.emitterId}`);
  }
  frames++;
};
const checkState = async (label) => {
  const actual = await client.checkpoint();
  const expected = runtime.checkpoint();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw Error(`Worker checkpoint differs from synchronous runtime: ${label}`);
  return actual;
};
try {
  const initialized = await client.initialize(payload);
  if (initialized.emulatedInstructions !== 0)
    throw Error("Direct worker unexpectedly executed guest instructions");
  let saved;
  for (const time of [0, 1 / 60, 0.1, 0.25, 0.5]) {
    runtime.advanceTo(time);
    const packet = await client.frame(time, cameras[0]);
    await checkDraw(
      packet,
      runtime.generateDraws(cameras[0]),
      `forward ${time}`,
    );
    saved = await checkState(`forward ${time}`);
  }
  if (!activeFrames || !peakParticles)
    throw Error("Worker control did not activate particles");
  const pristine = structuredClone(saved);
  const activeEmitter = saved.instances
    .flatMap(([, instance]) => instance.emitters)
    .find((e) => e.count);
  if (!activeEmitter)
    throw Error("Worker checkpoint has no active emitter state");
  activeEmitter.data.fill(12345);
  if (JSON.stringify(await client.checkpoint()) !== JSON.stringify(pristine))
    throw Error("Caller checkpoint mutation changed worker state");
  for (const camera of cameras) {
    const packet = await client.camera(camera);
    if (
      packet.metrics.simulationMs !== 0 ||
      packet.metrics.simulationStepsAdvanced !== 0
    )
      throw Error("Camera-only request advanced simulation");
    await checkDraw(
      packet,
      runtime.generateDraws(camera),
      "camera without simulation",
    );
    await checkState("camera without simulation");
    // Received draw storage is caller-owned and must not alias retained pools.
    for (const draw of packet.draws)
      for (const value of Object.values(draw))
        if (ArrayBuffer.isView(value)) value.fill(0);
    const repeated = await client.camera(camera);
    await checkDraw(
      repeated,
      runtime.generateDraws(camera),
      "mutated received buffers",
    );
    await checkState("mutated received buffers");
    cameraRedraws += 2;
  }
  snapshots.push({
    label: "active",
    time: pristine.time,
    sha256: await digest(pristine),
  });
  for (const time of [0.75, 1, 2]) {
    runtime.advanceTo(time);
    await checkDraw(
      await client.frame(time, cameras[1]),
      runtime.generateDraws(cameras[1]),
      `tail ${time}`,
    );
    await checkState(`tail ${time}`);
  }
  for (let seek = 0; seek < 3; seek++) {
    runtime.advanceTo(0.1);
    await checkDraw(
      await client.frame(0.1, cameras[2]),
      runtime.generateDraws(cameras[2]),
      "backward seek",
    );
    await checkState("backward seek");
    runtime.advanceTo(0.5);
    await checkDraw(
      await client.frame(0.5, cameras[0]),
      runtime.generateDraws(cameras[0]),
      "repeated forward seek",
    );
    await checkState("repeated forward seek");
  }
  await client.restore(pristine);
  runtime.restore(pristine);
  await checkDraw(
    await client.camera(cameras[1]),
    runtime.generateDraws(cameras[1]),
    "explicit checkpoint restore",
  );
  await checkState("explicit checkpoint restore");
  runtime.advanceTo(2);
  await checkDraw(
    await client.frame(2, cameras[0]),
    runtime.generateDraws(cameras[0]),
    "restored forward playback",
  );
  const terminal = await checkState("restored forward playback");
  snapshots.push({
    label: "after restored playback",
    time: terminal.time,
    sha256: await digest(terminal),
  });
} finally {
  clearTimeout(deadline);
  client.close();
  await client.termination;
}
// Re-read inputs after the asynchronous run: concurrent source changes must
// invalidate evidence rather than acquire an end-of-run producer fingerprint.
for (const path of Object.keys(inputs)) await bytes(path);
if (!trailOnly && packedParticleUVDraws === 0)
  throw Error("Active quad particle UV transfer controls required");
const result = {
  schema: 1,
  kind: "active-direct-component-module-worker-checkpoint-control",
  contract: runtime.contract,
  definitions: definitions.length,
  admittedComponents: definitions.reduce((n, d) => n + d.emitters.length, 0),
  generatedComponents: [...generatedComponents].sort(),
  frames,
  cameraRedraws,
  activeFrames,
  peakParticles,
  packedParticleUVDraws,
  snapshots,
  checks: {
    synchronousGeometryAndState: true,
    exactTransferredBufferAccounting: true,
    quadParticleUVThreeHalfLanesPerParticle: !trailOnly,
    finiteTransportTimingsWithSchedulingScope: true,
    independentTransferredDraws: true,
    independentCheckpointCopies: true,
    cameraWithoutSimulation: true,
    repeatedBackwardAndForwardSeeks: 3,
    explicitRestoreAndForwardPlayback: true,
  },
  inputs,
  scope: {
    realModuleWorker: true,
    syntheticEvents: true,
    suppliedActivationAndWorld: true,
    independentNativeGeometryComparison: false,
    matchCoverage: false,
    browserPlayback: false,
    gpuSubmission: false,
  },
};
const output = `${cache}/research/direct-${trailOnly ? "trail-" : ""}worker-checkpoints.json`;
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    {
      output,
      ...result,
      inputs: undefined,
      generatedComponents: result.generatedComponents.length,
    },
    null,
    2,
  ),
);
