import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256 } from "../structural-comparison.mjs";
import { createLatestResourceRequestTrack } from "../latest-resource-requests.mjs";
import {
  createLatestWorldPresentation,
  buildLatestDirectEffectEvents,
} from "../latest-world-presentation.mjs";
import { readPresentationBaseFlags } from "../latest-presentation-targets.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { decodeRegisteredState } from "../latest-state-fields.mjs";
import { CHAMPION_STATE_SHA } from "../latest-champion-state.mjs";
import { targetedPresentationDiagnostics } from "./targeted-presentation-diagnostics.mjs";
import { fixedTimePresentationDiagnostics } from "./fixed-time-presentation-diagnostics.mjs";
import { missileFamiliesDiagnostics } from "./missile-families-diagnostics.mjs";
import { sampleLatestMissileTrace } from "../latest-missile-playback.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const root = resolve(import.meta.dir, "..");
const endTime = Number(process.argv[3] ?? 99);
const reportOutputIndex = process.argv.indexOf("--report-output");
const reportOutput =
  reportOutputIndex < 0 ? null : process.argv[reportOutputIndex + 1];
if (reportOutputIndex >= 0 && (!reportOutput || reportOutput.startsWith("--")))
  throw Error("Explicit diagnostic report output path required");
const assetBaseArgument = process.argv[4];
let assetBase = null;
if (
  assetBaseArgument !== undefined &&
  assetBaseArgument !== "--report-output"
) {
  let parsed;
  try {
    parsed = new URL(assetBaseArgument);
  } catch {
    throw Error(
      "Optional fourth positional argument must be an absolute http(s) asset base; --report-output is a separate option",
    );
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw Error("Reconstruction asset base must use http(s)");
  assetBase = parsed.href;
}
const fingerprints = {};
const raw = async (path) => {
  const bytes = await Bun.file(path).bytes();
  const hash = await sha256(bytes);
  if (fingerprints[path] && fingerprints[path] !== hash)
    throw Error(`Input changed while preparing reconstruction: ${path}`);
  fingerprints[path] = hash;
  return bytes;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const assets = `${cache}/public`;
const installation = await read(`${cache}/latest-installation.json`);
const replayBytes = await raw(installation.replay.file);
if ((await sha256(replayBytes)) !== installation.replay.sha256)
  throw Error("Original reconstruction replay changed");
const reference = await read(
  `${cache}/research/resource-requests-comparison.json`,
);
for (const [path, expected] of Object.entries(reference.inputs))
  if ((await sha256(await raw(path))) !== expected)
    throw Error(`Stale resource request comparison: ${path}`);
const inputs = {
  buffer: replayBytes.buffer.slice(
    replayBytes.byteOffset,
    replayBytes.byteOffset + replayBytes.byteLength,
  ),
  profile: await read(`${assets}/decoder-16.21-macos/profile.json`),
  image: await raw(`${assets}/decoder-16.21-macos/image.bin`),
  constructors: await raw(`${assets}/decoder-16.21-macos/constructors.bin`),
  fieldCodecBytes: await raw(`${assets}/decoder-16.21-macos/field-codecs.json`),
  endTime,
  deltaMode: "signed8",
};
for (const [key, directory, file = "package.json"] of [
  ["startupConfigBytes", "latest-startup-config"],
  ["effectRemovalBytes", "latest-effect-removal"],
  ["effectCreationBytes", "latest-effect-creation"],
  ["effectPlacementBytes", "latest-effect-placement"],
  ["effectDescriptorBytes", "latest-effect-descriptor"],
  ["appearanceStackInputBytes", "latest-appearance-stack-inputs"],
  ["unitFormInputBytes", "latest-unit-form-inputs"],
  ["missileTargetInputBytes", "latest-missile-targets"],
  ["targetVisibilityInputBytes", "latest-target-visibility"],
  ["targetVisibilityMaskInputBytes", "latest-target-visibility-masks"],
  ["replicationBytes", "latest-replication"],
  ["championStateBytes", "latest-champion-state"],
  ["combatStatBytes", "latest-combat-stats"],
  ["experienceBytes", "latest-experience"],
  ["inventoryBytes", "latest-inventory"],
  ["corpsePolicyBytes", "latest-corpse"],
  ["worldStateBytes", "latest-world-state"],
  ["worldSceneBytes", "latest-scene", "manifest.json"],
  ["worldCatalogBytes", "latest-scene", "world.json"],
])
  inputs[key] = await raw(`${assets}/${directory}/${file}`);
const runtimePath = `${assets}/vendor/unicorn_x86_candidate.mjs`;
const runtimeManifest = await read(runtimePath.replace(/\.mjs$/, ".json"));
if ((await sha256(await raw(runtimePath))) !== runtimeManifest.sha256)
  throw Error("Reconstruction worker runtime differs");
await raw(`${assets}/vendor/fzstd.mjs`);
for (const file of [
  "latest-reconstruction.mjs",
  "structural-check-worker.mjs",
  "tools/inspect-latest-semantics.mjs",
  "tools/resource-reconstruction-control-worker.mjs",
  "tools/inspect-resource-reconstruction.mjs",
  "latest-resource-requests.mjs",
  "latest-missile-targets.mjs",
  "latest-target-visibility.mjs",
  "latest-target-visibility-masks.mjs",
  "latest-world-presentation.mjs",
  "latest-target-visibility-policy.mjs",
  "latest-initial-visibility-prefix.mjs",
  "latest-presentation-targets.mjs",
  "latest-state-fields.mjs",
  "latest-champion-state.mjs",
  "latest-terrain.mjs",
  "latest-targeted-missile-presentation.mjs",
  "latest-fields.mjs",
  "latest-cast-indexed-overrides.mjs",
  "latest-fixed-time-movement.mjs",
  "latest-fixed-time-spec.mjs",
  "latest-fixed-time-presentation.mjs",
  "latest-fixed-time-context.mjs",
  "latest-missile-presentation-context.mjs",
  "latest-missile-presentation-families.mjs",
  "tools/missile-families-diagnostics.mjs",
  "tools/fixed-time-presentation-diagnostics.mjs",
  "latest-targeted-missile-context.mjs",
  "latest-targeted-missile-client.mjs",
  "latest-particle-worker-client.mjs",
  "latest-targeted-missile-worker.mjs",
  "latest-projectile-presentation.mjs",
  "latest-missile-effect-basis.mjs",
  "latest-direct-effect-session.mjs",
  "tools/check-direct-effect-bundles.mjs",
  "latest-presentation-missile-actors.mjs",
  "latest-match-velocity-facing.mjs",
  "latest-missile-tracking.mjs",
  "latest-missiles.mjs",
  "latest-missile-playback.mjs",
  "latest-missile-initialization.mjs",
  "latest-missile-frame.mjs",
  "latest-missile-controllers.mjs",
  "latest-missile-actors.mjs",
  "tools/targeted-presentation-diagnostics.mjs",
])
  await raw(resolve(root, file));
await captureDirectSourceInputs(
  [
    import.meta.path,
    resolve(import.meta.dir, "resource-reconstruction-control-worker.mjs"),
  ],
  raw,
);
const worker = new Worker(
  new URL("./resource-reconstruction-control-worker.mjs", import.meta.url),
  { type: "module" },
);
let timer;
const response = new Promise((resolveResult, reject) => {
  timer = setTimeout(
    () =>
      reject(
        Error(
          "Ordinary reconstruction worker exceeded its bounded control window",
        ),
      ),
    120000,
  );
  worker.onmessage = ({ data }) =>
    data.ok
      ? resolveResult(data.report)
      : reject(Error(`${data.error.name}: ${data.error.message}`));
  worker.onerror = (event) => reject(Error(event.message));
  worker.onmessageerror = () =>
    reject(Error("Reconstruction worker report could not be decoded"));
});
worker.postMessage({
  inputs,
  runtimeModuleUrl: pathToFileURL(runtimePath).href,
  decompressModuleUrl: pathToFileURL(`${assets}/vendor/fzstd.mjs`).href,
});
let report;
try {
  report = await response;
} finally {
  clearTimeout(timer);
  await worker.terminate();
}
const appearance = await read(`${cache}/research/appearance-packets.json`);
const forms = await read(`${cache}/research/unit-form-inputs-comparison.json`);
const expected = [...appearance.records, ...forms.records]
  .filter((record) => record.time <= endTime)
  .sort((a, b) => a.time - b.time || a.transportSequence - b.transportSequence);
if (
  report.resourceRequests.length !== expected.length ||
  report.resourceRequestScope.acceptedProducerMutations !== false ||
  report.resourceRequestScope.resourceTracksSynthesized !== false
)
  throw Error("Ordinary worker request count or acceptance boundary differs");
for (const [index, record] of expected.entries()) {
  const actual = report.resourceRequests[index];
  for (const key of Object.keys(record).filter(
    (key) =>
      !["param", "payloadHex", "objectHex", "heapHex", "entryRva"].includes(
        key,
      ),
  ))
    if (JSON.stringify(actual[key]) !== JSON.stringify(record[key]))
      throw Error(
        `Ordinary worker request field differs: ${record.transportSequence}:${key}`,
      );
  if (actual.acceptedByLiveUnit !== null || actual.resourceIdentity !== null)
    throw Error(
      "Ordinary worker promoted a request to accepted resource state",
    );
}
const track = createLatestResourceRequestTrack(report.resourceRequests);
for (const record of report.resourceRequests) {
  if (
    track
      .requests(record.entityId, record.time, record.stream, {
        transportSequence: record.transportSequence,
        entryOrder: 0,
      })
      .at(-1)?.id !== record.id
  )
    throw Error("Ordinary worker resource request causal query differs");
}
const targetReference = await read(
  `${cache}/research/missile-targets-comparison.json`,
);
for (const [path, expected] of Object.entries(targetReference.inputs))
  if ((await sha256(await raw(path))) !== expected)
    throw Error(`Stale requested target comparison: ${path}`);
const targetLocations = new Map();
for (const inputName of ["projectile-combat-input.json", "combat-input.json"]) {
  const source = await read(`${cache}/research/${inputName}`);
  const nativeSource = inputName.replace("-input.json", "-native.json");
  for (const result of targetReference.results.filter(
    (entry) =>
      entry.source.replaceAll("\\", "/").split("/").at(-1) === nativeSource,
  )) {
    const packet = source.packets[result.key];
    if (!packet || packet.opcode !== result.opcode)
      throw Error("Requested target oracle packet identity differs");
    const key = `${packet.stream}:${packet.chunkId}:${packet.blockOffset}`;
    const identities = result.targets.map((target) => target.requestedEntityId);
    if (
      targetLocations.has(key) &&
      JSON.stringify(targetLocations.get(key)) !== JSON.stringify(identities)
    )
      throw Error("Repeated target oracle packet differs");
    targetLocations.set(key, identities);
  }
}
let reconstructedTargets = 0,
  nativeComparedTargetPackets = 0,
  nativeComparedTargets = 0;
for (const event of [...report.missiles, ...report.casts]) {
  const cast = event.cast ?? event;
  if (
    !Array.isArray(cast.requestedTargets) ||
    cast.requestedTargets.length !== cast.targetCount ||
    cast.requestedTargets.some(
      (target, index) =>
        target.index !== index || target.acceptedEntityId !== null,
    )
  )
    throw Error("Reconstructed requested target boundary differs");
  reconstructedTargets += cast.requestedTargets.length;
  const expected = targetLocations.get(
    `${event.stream}:${event.chunkId}:${event.blockOffset}`,
  );
  if (!expected) continue;
  if (
    JSON.stringify(
      cast.requestedTargets.map((target) => target.requestedEntityId),
    ) !== JSON.stringify(expected)
  )
    throw Error(
      "Ordinary worker requested targets differ from original native conversion",
    );
  nativeComparedTargetPackets++;
  nativeComparedTargets += expected.length;
}
if (
  !nativeComparedTargetPackets ||
  !nativeComparedTargets ||
  report.missileTargetInputContract.acceptedWorldTargets !== false
)
  throw Error("Missing ordinary worker requested target comparison");
const missileTargetControl = {
  reconstructedTargets,
  nativeComparedTargetPackets,
  nativeComparedTargets,
  contract: report.missileTargetInputContract,
};
const visibilityReference = await read(
  `${cache}/research/target-visibility-comparison.json`,
);
for (const [path, expected] of Object.entries(visibilityReference.inputs))
  if ((await sha256(await raw(path))) !== expected)
    throw Error(`Stale raw visibility evidence: ${path}`);
const visibilityLocations = new Map(
  visibilityReference.records
    .filter((record) => record.time <= endTime)
    .map((record) => [
      `${record.stream}:${record.chunkId}:${record.blockOffset}`,
      record,
    ]),
);
const primaryVisibilityRequests = report.visibilityRequests.filter(
  (record) => record.opcode === 822,
);
if (
  primaryVisibilityRequests.length !== visibilityLocations.size ||
  report.targetVisibilityInputContract.acceptedLiveVisibility !== false
)
  throw Error(
    `Ordinary worker raw visibility request boundary differs: ${report.visibilityRequests.length} records, ${visibilityLocations.size} oracle packets, accepted=${report.targetVisibilityInputContract.acceptedLiveVisibility}`,
  );
for (const request of primaryVisibilityRequests) {
  const original = visibilityLocations.get(
    `${request.stream}:${request.chunkId}:${request.blockOffset}`,
  );
  for (const key of [
    "time",
    "entityId",
    "primaryPayloadHex",
    "secondaryPayloadHex",
    "status",
    "visible",
    "acceptedByLiveUnit",
    "transportSequence",
  ])
    if (JSON.stringify(request[key]) !== JSON.stringify(original?.[key]))
      throw Error(`Ordinary worker raw visibility request differs: ${key}`);
  if (
    request.id !== `visibility-request:${request.transportSequence}:0` ||
    request.entryOrder !== 0
  )
    throw Error("Ordinary worker visibility request causal identity differs");
}
const visibilityRequestControl = {
  packets: primaryVisibilityRequests.length,
  gameplay: primaryVisibilityRequests.filter((record) => record.stream === 1)
    .length,
  snapshots: primaryVisibilityRequests.filter((record) => record.stream === 2)
    .length,
  contract: report.targetVisibilityInputContract,
};
const maskReference = await read(
  `${cache}/research/target-visibility-masks-comparison.json`,
);
for (const [path, expected] of Object.entries(maskReference.inputs))
  if ((await sha256(await raw(path))) !== expected)
    throw Error(`Stale raw mask evidence: ${path}`);
const maskLocations = new Map(
  maskReference.records
    .filter((record) => record.time <= endTime)
    .map((record) => [
      `${record.stream}:${record.chunkId}:${record.blockOffset}`,
      record,
    ]),
);
const maskRequests = report.visibilityRequests.filter((record) =>
  [48, 582, 918].includes(record.opcode),
);
if (
  maskRequests.length !== maskLocations.size ||
  report.targetVisibilityMaskInputContract.acceptedLiveVisibility !== false ||
  report.visibilityRequests.length !==
    primaryVisibilityRequests.length + maskRequests.length
)
  throw Error("Ordinary worker mask/reset request boundary differs");
for (const request of maskRequests) {
  const original = maskLocations.get(
    `${request.stream}:${request.chunkId}:${request.blockOffset}`,
  );
  for (const key of [
    "time",
    "stream",
    "entityId",
    "opcode",
    "rawObjectHex",
    "encodedViewSlotByte",
    "status",
    "visible",
    "acceptedByLiveUnit",
    "transportSequence",
  ])
    if (JSON.stringify(request[key]) !== JSON.stringify(original?.[key]))
      throw Error(`Ordinary worker raw mask request differs: ${key}`);
  if (
    request.id !== `visibility-request:${request.transportSequence}:0` ||
    request.entryOrder !== 0
  )
    throw Error("Ordinary worker mask causal identity differs");
}
const visibilityMaskRequestControl = {
  packets: maskRequests.length,
  byOpcode: Object.fromEntries(
    [48, 582, 918].map((opcode) => [
      opcode,
      maskRequests.filter((r) => r.opcode === opcode).length,
    ]),
  ),
  gameplay: maskRequests.filter((r) => r.stream === 1).length,
  snapshots: maskRequests.filter((r) => r.stream === 2).length,
  separatelyExecuted918Control: maskReference.controls,
  contract: report.targetVisibilityMaskInputContract,
};
const scene = JSON.parse(new TextDecoder().decode(inputs.worldSceneBytes)),
  heights = await raw(`${assets}/latest-scene/heights.bin`),
  terrain = createLatestTerrain(
    scene,
    new Float32Array(
      heights.buffer,
      heights.byteOffset,
      heights.byteLength / 4,
    ),
  ),
  world = createLatestWorldPresentation({
    report,
    scene,
    terrain,
  });
const targetedMissilePresentationControl =
  await targetedPresentationDiagnostics({
    report,
    scene,
    terrain,
    world,
    assets,
    profile: inputs.profile,
    raw,
    read,
    endTime,
    heights: new Float32Array(
      heights.buffer,
      heights.byteOffset,
      heights.byteLength / 4,
    ),
    assetBase,
  });
const fixedTimePresentationControl = await fixedTimePresentationDiagnostics({
  report,
  scene,
  terrain,
  world,
  assets,
  profile: inputs.profile,
  raw,
  endTime,
  heights: new Float32Array(
    heights.buffer,
    heights.byteOffset,
    heights.byteLength / 4,
  ),
  assetBase,
});
const missileFamiliesControl = await missileFamiliesDiagnostics({
  fixedSpeed: targetedMissilePresentationControl,
  fixedTime: fixedTimePresentationControl,
  report,
  scene,
  terrain,
  world,
  assets,
  profile: inputs.profile,
  raw,
  endTime,
  heights: new Float32Array(
    heights.buffer,
    heights.byteOffset,
    heights.byteLength / 4,
  ),
  assetBase,
});
const targetedLedger = buildLatestDirectEffectEvents({
  pipeline: { events: [] },
  report,
  targetedMissilePresentation: missileFamiliesControl,
});
const projectileLifecycleLedgerControl = {
  motionReadyOmittedRequests: targetedLedger.filter(
    (event) => event.motionPresentation,
  ).length,
  emittedCastRequests: targetedLedger.filter(
    (event) => event.origin === "missile-behavior",
  ).length,
  sharedMainEventBuilder: true,
  networkRequestsIncluded: false,
  particleActivation: false,
};
if (
  projectileLifecycleLedgerControl.motionReadyOmittedRequests !==
    missileFamiliesControl.traces.length ||
  projectileLifecycleLedgerControl.emittedCastRequests !==
    missileFamiliesControl.summary.emittedCastRequests ||
  targetedLedger.some((event) => event.kind !== "omitted")
)
  throw Error(
    "Shared targeted lifecycle ledger differs from diagnostic motion contract",
  );
const projectileWorld = createLatestWorldPresentation({
  report,
  scene,
  terrain,
  targetedMissilePresentation: missileFamiliesControl,
});
const projectileQueryControl = [];
for (const trace of missileFamiliesControl.traces) {
  const record = report.missiles.find(
    (row) => row.sequence === trace.sequence && row.entityId === trace.entityId,
  );
  const c = {
    transportSequence: record.transportSequence,
    entryOrder: record.entryOrder ?? 0,
  };
  if (
    projectileWorld.projectilePresentation(trace.entityId, trace.startTime, {
      ...c,
      exclusive: true,
    }) !== null
  )
    throw Error("Generated projectile exists before its creating packet");
  for (const time of [
    trace.startTime,
    (trace.startTime + trace.states.at(-1).time) / 2,
    trace.states.at(-1).time,
  ]) {
    const motion = projectileWorld.projectilePresentation(trace.entityId, time),
      entity = projectileWorld.entity(trace.entityId, time),
      repeat = projectileWorld.projectile(trace.sequence, time),
      expectedBasis = trace.effectBasisProgram
        ? sampleLatestMissileTrace(trace, time).effectBasis
        : null;
    if (
      !motion ||
      JSON.stringify(motion.position) !== JSON.stringify(entity?.position) ||
      JSON.stringify(motion) !== JSON.stringify(repeat) ||
      entity.resourceStack !== null ||
      (expectedBasis === null
        ? motion.basis !== null
        : !Array.isArray(motion.basis) ||
          motion.basis.length !== expectedBasis.length ||
          motion.basis.some(
            (lane, index) => !Object.is(lane, expectedBasis[index]),
          )) ||
      motion.nativeAcceptance !== null
    )
      throw Error(
        "Shared generated projectile query, verified basis or unresolved resource boundary differs",
      );
    projectileWorld.projectilePresentation(trace.entityId, trace.startTime);
    if (
      JSON.stringify(
        projectileWorld.projectilePresentation(trace.entityId, time),
      ) !== JSON.stringify(motion)
    )
      throw Error("Generated projectile backward/repeated seek differs");
    projectileQueryControl.push({
      entityId: trace.entityId,
      time,
      position: motion.position,
      lifecycle: motion.lifecycle,
      basis: motion.basis,
      nativeAcceptance: motion.nativeAcceptance,
    });
  }
}
const traceIds = new Set(
  missileFamiliesControl.traces.map((trace) => trace.entityId),
);
const projectileEffectReferences = report.effectDescriptors.flatMap(
  (descriptor) =>
    [
      "resourceContextEntityId",
      "attachmentEntityId",
      "lookup14EntityId",
      "lookupA8EntityId",
    ]
      .filter((field) => traceIds.has(descriptor[field]))
      .map((field) => ({
        creationSequence: descriptor.creationSequence,
        field,
        entityId: descriptor[field],
        time: descriptor.time,
        resolvedPose:
          projectileWorld.entity(descriptor[field], descriptor.time, {
            transportSequence: descriptor.transportSequence,
            entryOrder: descriptor.creationSequence,
          })?.position ?? null,
        remainingDependencies: [
          "world:missile-transform-provider-and-root-basis",
          "resource:actual-live-stack-and-effect-binding",
        ],
      })),
);
const policySamples = [];
for (const time of [69, 84, 99].filter((time) => time <= endTime))
  for (const hero of report.heroes) {
    const result = world.visibility(hero.entityId, time);
    if (
      !result.resolved ||
      result.nativeAcceptedInternalId !== null ||
      result.nativeAcceptance !== null ||
      world.entity(hero.entityId, time).visibility !== "unknown"
    )
      throw Error("Actual hero policy escaped declared diagnostic boundary");
    policySamples.push({ entityId: hero.entityId, time, result });
  }
const afterHeroCreation = (event) =>
  report.heroes.some(
    (hero) =>
      hero.entityId === event.entityId &&
      (hero.provenance.time < event.time ||
        (hero.provenance.time === event.time &&
          hero.provenance.transportSequence < event.transportSequence)),
  );
const firstGameplayPrimary = primaryVisibilityRequests.find(
  (event) => event.stream === 1 && afterHeroCreation(event),
);
const firstGameplayMask = maskRequests.find(
  (event) =>
    event.stream === 1 && event.opcode === 48 && afterHeroCreation(event),
);
const firstInitialSnapshotPrimary = primaryVisibilityRequests.find(
  (event) => event.stream === 2 && event.time === 0 && afterHeroCreation(event),
);
const firstLaterSnapshotPrimary = primaryVisibilityRequests.find(
  (event) => event.stream === 2 && event.time > 0 && afterHeroCreation(event),
);
const causalQuery = (event, applied) => {
  if (!event) return null;
  const cursor = {
      transportSequence: event.transportSequence,
      entryOrder: event.entryOrder,
    },
    before = world.visibility(event.entityId, event.time, {
      ...cursor,
      exclusive: true,
    }),
    after = world.visibility(event.entityId, event.time, cursor);
  if (
    !before.resolved ||
    !after.resolved ||
    before.sourceEventIds.includes(event.id) ||
    after.sourceEventIds.includes(event.id) !== applied ||
    (applied &&
      event.opcode === 48 &&
      before.state.mask === after.state.mask) ||
    (applied &&
      event.stream === 2 &&
      event.opcode === 822 &&
      (before.state.initialized ||
        !after.state.initialized ||
        !after.initialRestorePrefixEvents.some(
          (prefix) => prefix.id === event.id,
        ))) ||
    (!applied &&
      (!after.ignoredSnapshotEventIds.includes(event.id) ||
        JSON.stringify(before.state) !== JSON.stringify(after.state)))
  )
    throw Error("Actual visibility same-time event boundary differs");
  const repeated = world.visibility(event.entityId, event.time, {
    ...cursor,
    exclusive: true,
  });
  if (JSON.stringify(before) !== JSON.stringify(repeated))
    throw Error("Visibility backward query mutated retained state");
  return {
    eventId: event.id,
    entityId: event.entityId,
    time: event.time,
    before,
    after,
    backwardRepeatMatched: true,
    applied,
  };
};
const visibilityPolicyControl = {
  samples: policySamples,
  gameplayPrimary: causalQuery(firstGameplayPrimary, true),
  gameplayPrimaryOmission: firstGameplayPrimary
    ? null
    : "fixture:no-hero-opcode822-gameplay-request-through-window",
  gameplayMask: causalQuery(firstGameplayMask, true),
  initialSnapshotPrimaryPrefix: causalQuery(firstInitialSnapshotPrimary, true),
  ignoredLaterSnapshotPrimary: causalQuery(firstLaterSnapshotPrimary, false),
  actualNativeAcceptance: null,
  originalOwnerCallbacksExecuted: false,
};
if ((await sha256(inputs.championStateBytes)) !== CHAMPION_STATE_SHA)
  throw Error("Base-flag inventory requires pinned champion schema");
const championSchema = JSON.parse(
  new TextDecoder().decode(inputs.championStateBytes),
);
if (
  championSchema.groups[4]?.offsets[0] !== 0xc50 ||
  championSchema.groups[4].floatMask & 1
)
  throw Error("Base-flag inventory field registration differs");
const heroIds = new Set(report.heroes.map((hero) => hero.entityId)),
  baseFlagRecords = [];
for (const record of report.replicationRecords) {
  if (
    !heroIds.has(record.entityId) ||
    !record.groups.some((group) => group.group === 4 && group.mask & 1)
  )
    continue;
  if (!Number.isSafeInteger(record.recordIndex) || record.recordIndex < 0)
    throw Error(
      "Original replication record ordinal required for base-flag inventory",
    );
  const decoded = decodeRegisteredState(record, championSchema),
    group = decoded.groups.find((group) => group.group === 4),
    value = group.fieldBits[0];
  if (readPresentationBaseFlags(record).value !== value)
    throw Error(
      "Presentation base-flags prefix differs from complete registered state decoder",
    );
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    throw Error("Original registered uint32 base-flag field required");
  baseFlagRecords.push({
    id: `base-flags:${record.transportSequence}:${record.recordIndex}:4:0`,
    entityId: record.entityId,
    time: record.time,
    stream: record.stream,
    chunkId: record.chunkId,
    blockOffset: record.blockOffset,
    transportSequence: record.transportSequence,
    entryOrder: record.recordIndex,
    group: 4,
    fieldIndex: 0,
    registeredOffset: 0xc50,
    value,
    bit20000Set: Boolean(value & 0x20000),
    acceptedByLiveUnit: null,
  });
}
const baseFlagInventory = {
  schemaSha256: CHAMPION_STATE_SHA,
  records: baseFlagRecords,
  count: baseFlagRecords.length,
  heroesObserved: new Set(baseFlagRecords.map((r) => r.entityId)).size,
  gameplay: baseFlagRecords.filter((r) => r.stream === 1).length,
  snapshots: baseFlagRecords.filter((r) => r.stream === 2).length,
  bit20000SetRecords: baseFlagRecords.filter((r) => r.bit20000Set).length,
  acceptedTargetStateRecovered: false,
  liveReplicationApplied: false,
};
const targetGateTransitions = [];
for (const record of baseFlagRecords.filter(
  (row) => row.stream === 1 && row.bit20000Set,
)) {
  const cursor = {
    transportSequence: record.transportSequence,
    entryOrder: record.entryOrder,
  };
  const before = world.presentationTarget(record.entityId, record.time, {
    ...cursor,
    exclusive: true,
  });
  const after = world.presentationTarget(record.entityId, record.time, cursor);
  if (
    !before.resolved ||
    !after.resolved ||
    before.presentationEligible !== true ||
    after.presentationEligible !== false ||
    after.baseFlags !== record.value ||
    after.nativeAcceptance !== null ||
    after.nativeAcceptedInternalId !== null ||
    after.sourceEventIds.at(-1) !== record.id ||
    JSON.stringify(
      world.presentationTarget(record.entityId, record.time, {
        ...cursor,
        exclusive: true,
      }),
    ) !== JSON.stringify(before)
  )
    throw Error(
      "Actual causal constructor-view target gate transition differs",
    );
  targetGateTransitions.push({
    eventId: record.id,
    entityId: record.entityId,
    time: record.time,
    before,
    after,
    backwardRepeatMatched: true,
  });
}
const presentationTargetControl = {
  transitions: targetGateTransitions,
  registeredPrefixComparisons: baseFlagRecords.length,
  actualNativeAcceptance: null,
  declaredConstructorViewPolicyOnly: true,
  motionAdmissionChanged: false,
};
const inComparison = (event) => event.time >= 69 && event.time <= 99;
const comparisonSourceCounts =
  endTime >= 99
    ? {
        heroAttacks: report.attacks.filter(
          (event) =>
            inComparison(event) &&
            report.heroes.some((hero) => hero.entityId === event.entityId),
        ).length,
        heroCasts: report.casts.filter(
          (event) =>
            inComparison(event) &&
            report.heroes.some((hero) => hero.entityId === event.entityId),
        ).length,
        missileRecords: report.missiles.filter(inComparison).length,
        creationRequests: report.effectCreations.filter(inComparison).length,
      }
    : null;
if (
  comparisonSourceCounts &&
  JSON.stringify(comparisonSourceCounts) !==
    JSON.stringify({
      heroAttacks: 105,
      heroCasts: 135,
      missileRecords: 162,
      creationRequests: 1110,
    })
)
  throw Error(
    "Pinned comparison-window categories changed during resource request integration",
  );
for (const [path, expected] of Object.entries(fingerprints))
  if ((await sha256(await Bun.file(path).bytes())) !== expected)
    throw Error(`Ordinary reconstruction evidence input changed: ${path}`);
const output = `${cache}/research/resource-reconstruction-worker-control.json`;
if (
  reportOutput !== null &&
  (resolve(reportOutput) === resolve(output) ||
    Object.keys(fingerprints).some(
      (path) => resolve(path) === resolve(reportOutput),
    ))
)
  throw Error(
    "Diagnostic export must not overwrite its source or control report",
  );
const result = {
  schema: 1,
  build: report.build,
  protocol: report.protocol,
  replaySha256: report.replaySha256,
  endTime,
  summary: report.summary,
  comparisonSourceCounts,
  resourceRequestContract: report.resourceRequestContract,
  resourceRequestScope: report.resourceRequestScope,
  resourceRequests: report.resourceRequests,
  missileTargetControl,
  visibilityRequestControl,
  visibilityMaskRequestControl,
  visibilityPolicyControl,
  baseFlagInventory,
  presentationTargetControl,
  targetedMissilePresentationControl,
  fixedTimePresentationControl,
  missileFamiliesControl,
  projectileQueryControl,
  projectileEffectReferences,
  projectileLifecycleLedgerControl,
  inputs: fingerprints,
  scope: {
    actualModuleWorker: true,
    ordinaryReconstructionFunction: true,
    browserHttpLoaderExecuted: false,
    originalReplayFieldsCompared: true,
    liveProducerAcceptanceVerified: false,
    resourceStacksSynthesized: false,
    browserVisualAcceptance: false,
  },
};
await Bun.write(output, JSON.stringify(result, null, 2));
// Diagnostic export only: ordinary browser playback still reconstructs its own
// replay. Keep the historical semantics artifact unchanged unless named here.
if (reportOutput !== null)
  await Bun.write(
    resolve(reportOutput),
    JSON.stringify({
      schema: 1,
      kind: "verified-ordinary-reconstruction-diagnostic-export",
      report,
      controlReportPath: output,
      controlReportSha256: await sha256(await Bun.file(output).bytes()),
      inputs: fingerprints,
      runtimePlaybackInput: false,
    }),
  );
console.log(
  JSON.stringify({
    output,
    endTime,
    requests: report.summary.resourceRequestRecords,
    gameplay: report.summary.gameplayResourceRequests,
    snapshots: report.summary.snapshotResourceRequests,
    byOpcode: report.summary.resourceRequestsByOpcode,
    comparisonSourceCounts,
    missileTargetControl,
    visibilityRequestControl,
    visibilityMaskRequestControl,
    visibilityPolicySamples: policySamples.length,
    baseFlagRecords: baseFlagRecords.length,
    targetedMissilePresentation: targetedMissilePresentationControl.summary,
    fixedTimePresentation: fixedTimePresentationControl.summary,
    missileFamilies: missileFamiliesControl.summary,
    inputFingerprintsVerified: Object.keys(fingerprints).length,
  }),
);
