import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { createLatestWorldPresentation } from "../latest-world-presentation.mjs";
import { loadLatestInitialResourcePrefix } from "../latest-initial-resource-prefix.mjs";
import { loadLatestViewerPoseAssets } from "../latest-viewer-pose-assets.mjs";
import { createTargetedMissilePresentation } from "../latest-targeted-missile-context.mjs";
import { createFixedTimePresentation } from "../latest-fixed-time-context.mjs";
import { createMissilePresentationFamilies } from "../latest-missile-presentation-context.mjs";
import { createProjectilePresentation } from "../latest-projectile-presentation.mjs";
import { ZERO_REFERENCE_FIXED_TIME_PRESENTATION_POLICY } from "../latest-zero-reference-fixed-time-presentation.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const raw = async (path) => {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Changed input: ${path}`);
  inputs[path] = digest;
  return bytes;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const load = (path) => raw(`${cache}/public/${path}`);
const requireEqual = (a, b, reason) => {
  if (!isDeepStrictEqual(a, b)) throw Error(reason);
};
await captureDirectSourceInputs([import.meta.path], raw);
const auditPath = `${cache}/research/direct-functional-verification-audit-v33.json`;
if (
  (await sha256(await raw(auditPath))) !==
  "6a0b972ce9a0ec2c29a180be06e0e34ad9c22d786e5ed0f930a99335bf217329"
)
  throw Error("Exact closed version33 audit required");
const audit = await read(auditPath),
  builderSourceControls = [];
const knownNativeClockChanges = [
  {
    name: "latest-fixed-time-presentation.mjs",
    current: "kernel.step(state, f(now), f(next - local), f(1 / 60))",
    original: "kernel.step(state, f(now), f(next - local))",
  },
  {
    name: "latest-targeted-missile-presentation.mjs",
    current: "          f(next - local),\n          f(1 / 60),\n",
    original: "          f(next - local),\n",
  },
];
for (const { name, current, original } of knownNativeClockChanges) {
  const path = resolve(import.meta.dir, "..", name),
    bytes = await raw(path),
    digest = await sha256(bytes),
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (source.split(current).length !== 2)
    throw Error(
      `Exactly one native global-clock caller change required: ${name}`,
    );
  const restored = new TextEncoder().encode(source.replace(current, original));
  if (audit.inputs[path] !== (await sha256(restored)))
    throw Error(
      `Family source changed beyond the exact native clock argument: ${name}`,
    );
  builderSourceControls.push({
    path,
    sha256: digest,
    version33Sha256: audit.inputs[path],
    exactKnownChange: { current, original },
    allOtherSourceBytesEqualVersion33: true,
    scope:
      "Original callback 0x890880 consumes supplied global delta; 60Hz remains an explicit presentation clock convention",
  });
}
const exported = await read(
  `${cache}/research/viewer-root-reconstruction.json`,
);
if (
  exported.runtimePlaybackInput !== false ||
  exported.kind !== "verified-ordinary-reconstruction-diagnostic-export"
)
  throw Error("Actual ordinary reconstruction required");
for (const [path, digest] of Object.entries(exported.inputs))
  if ((await sha256(await raw(path))) !== digest)
    throw Error(`Stale reconstruction: ${path}`);
if (
  (await sha256(await raw(exported.controlReportPath))) !==
  exported.controlReportSha256
)
  throw Error("Reconstruction control changed");
const report = exported.report;
if (report.endTime !== 99) throw Error("Complete comparison prefix required");
const scene = await read(`${cache}/public/latest-scene/manifest.json`),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  heightBytes = await load("latest-scene/heights.bin"),
  terrain = createLatestTerrain(
    scene,
    new Float32Array(
      heightBytes.buffer,
      heightBytes.byteOffset,
      heightBytes.byteLength / 4,
    ),
  ),
  initial = await loadLatestInitialResourcePrefix({
    profile,
    report,
    manifestBytes: await load("latest-effects/manifest.json"),
    load,
  }),
  viewerPoseAssets = await loadLatestViewerPoseAssets({
    profile,
    report,
    scene,
    load,
  }),
  world = createLatestWorldPresentation({
    report,
    scene,
    terrain,
    initialResourcePrefix: initial.policy,
    viewerPoseAssets,
  }),
  parameters = { report, scene, terrain, world, profile, load, endTime: 99 };
const standalone = [
    await createTargetedMissilePresentation(parameters),
    await createFixedTimePresentation(parameters),
  ],
  combined = await createMissilePresentationFamilies(parameters),
  originalFamilies = [];
for (const family of standalone) {
  const members = combined.traces.filter(
    (trace) => trace.policy === family.policy,
  );
  requireEqual(
    members,
    family.traces,
    `Original trace/state/basis/source metadata changed: ${family.policy}`,
  );
  originalFamilies.push({
    policy: family.policy,
    traces: members.length,
    states: members.reduce((n, trace) => n + trace.states.length, 0),
    exactTraceMetadata: true,
  });
}
const added = combined.traces.filter(
    (trace) => trace.policy === ZERO_REFERENCE_FIXED_TIME_PRESENTATION_POLICY,
  ),
  expectedIds = [
    "packet:41292:entry:0:missile:1073744553",
    "packet:41347:entry:0:missile:1073744556",
    "packet:41402:entry:0:missile:1073744559",
  ];
requireEqual(
  added.map((trace) => trace.sourceEventId),
  expectedIds,
  "Exact three decoded zero-reference creations required",
);
const projectiles = createProjectilePresentation(report, combined),
  controls = [];
for (const trace of added) {
  const record = report.missiles.find((row) => row.sequence === trace.sequence),
    cursor = {
      transportSequence: record.transportSequence,
      entryOrder: record.entryOrder ?? 0,
    };
  if (
    trace.ownerId !== 1073741894 ||
    trace.ownerId !== record.cast.ownerId ||
    trace.requestedTargetEntityId !== null ||
    !trace.effectBasisProgram
  )
    throw Error(
      "Decoded Jinx ownership and separate verified zero-reference basis required",
    );
  requireEqual(
    projectiles.query(trace.entityId, trace.startTime, {
      ...cursor,
      exclusive: true,
    }),
    null,
    "Creation visible before causal packet",
  );
  const first = projectiles.query(trace.entityId, trace.startTime, cursor);
  requireEqual(
    first.position,
    trace.states[0].position,
    "Initial placement differs at inclusive creation cursor",
  );
  const time = trace.startTime + (trace.stopTime - trace.startTime) / 2;
  const later = projectiles.query(trace.entityId, time),
    paused = projectiles.query(trace.entityId, time);
  requireEqual(later, paused, "Paused query changed retained presentation");
  projectiles.query(trace.entityId, trace.stopTime);
  requireEqual(
    projectiles.query(trace.entityId, time),
    later,
    "Backward/repeated presentation query changed state",
  );
  let notifications = 0;
  for (const state of trace.states.filter(
    (row) => row.notificationSourceEventId,
  )) {
    const eventCursor = {
      transportSequence: state.notificationTransportSequence,
      entryOrder: state.notificationEntryOrder,
    };
    const inclusive = projectiles.query(
      trace.entityId,
      state.time,
      eventCursor,
    );
    requireEqual(
      inclusive.position,
      state.position,
      "Notification cursor placement mismatch",
    );
    requireEqual(
      inclusive.velocity,
      state.velocity,
      "Notification cursor velocity mismatch",
    );
    requireEqual(
      inclusive.stopped,
      state.stopped,
      "Notification cursor lifecycle mismatch",
    );
    const previous = trace.states
      .filter(
        (row) =>
          row.time <= state.time &&
          (row.time < state.time ||
            !row.notificationSourceEventId ||
            row.notificationTransportSequence < eventCursor.transportSequence ||
            (row.notificationTransportSequence ===
              eventCursor.transportSequence &&
              row.notificationEntryOrder < eventCursor.entryOrder)),
      )
      .at(-1);
    const exclusive = projectiles.query(trace.entityId, state.time, {
      ...eventCursor,
      exclusive: true,
    });
    requireEqual(
      exclusive.velocity,
      previous.velocity,
      "Notification visible before original packet order",
    );
    requireEqual(
      exclusive.stopped,
      previous.stopped,
      "Stop visible before original packet order",
    );
    notifications++;
  }
  controls.push({
    sourceEventId: trace.sourceEventId,
    ownerId: trace.ownerId,
    states: trace.states.length,
    notifications,
    causalCreation: true,
    repeatedPauseAndBackwardQueries: true,
  });
}
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Source changed during comparison: ${path}`);
const output = `${cache}/research/missile-family-regressions-v34.json`;
const result = {
  schema: 1,
  kind: "actual-owned-missile-family-regression-control",
  artifactVersion: 34,
  build: report.build,
  protocol: report.protocol,
  builderSourceControls,
  originalFamilies,
  addedControls: controls,
  inputs,
  scope: {
    exactExistingBuilderTraceEquivalence: true,
    originalVersion33BuilderBytesUnchanged: false,
    oldAggregatePacketEquality: false,
    actualModuleWorker: false,
    browserObserved: false,
    gpuSubmission: false,
    nativeMatchAcceptance: null,
  },
};
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    originalFamilies,
    addedControls: controls,
    inputs: Object.keys(inputs).length,
  }),
);
