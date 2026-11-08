import { resolve } from "node:path";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { gearMetaHash } from "./gear-effect-extension.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { createLatestPositiveFormResourcePrefix } from "../latest-positive-form-resource-prefix.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { createLatestWorldPresentation } from "../latest-world-presentation.mjs";
import { loadLatestInitialResourcePrefix } from "../latest-initial-resource-prefix.mjs";
import { loadLatestViewerPoseAssets } from "../latest-viewer-pose-assets.mjs";
import {
  analyzeLatestMissiles,
  bindLatestMissileSpell,
  createLatestMissileMotion,
} from "../latest-missiles.mjs";
import { createLatestMissileControllers } from "../latest-missile-controllers.mjs";
import { createLatestMissileInitialization } from "../latest-missile-initialization.mjs";
import { createLatestMissileFrame } from "../latest-missile-frame.mjs";
import { createLatestMissileActors } from "../latest-missile-actors.mjs";
import { prepareFixedTimeRecords } from "../latest-fixed-time-spec.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {},
  planningFromFrozen = process.argv[3] === "--planning-from-frozen-v35";
if (process.argv[3] && !planningFromFrozen)
  throw Error("Unknown conjunction inspection mode");
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Input changed: ${path}`);
  inputs[path] = digest;
  return bytes;
}
const read = async (path) =>
    JSON.parse(new TextDecoder().decode(await raw(path))),
  load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], raw);
const exportedPath = `${cache}/research/${planningFromFrozen ? "viewer-root-reconstruction-v35-pre-startup" : "viewer-root-reconstruction"}.json`,
  exportedBytes = await raw(exportedPath),
  exported = JSON.parse(new TextDecoder().decode(exportedBytes)),
  historicalSourceDrift = [];
if (
  planningFromFrozen &&
  (await sha256(exportedBytes)) !==
    "ecf27e0bdea9dca4a048d5c46aca7c6c0a1401e89bb8c9c59f436877f581d681"
)
  throw Error("Exact frozen pre-startup planning export required");
if (
  exported.runtimePlaybackInput !== false ||
  exported.kind !== "verified-ordinary-reconstruction-diagnostic-export"
)
  throw Error("Ordinary diagnostic reconstruction required");
for (const [path, digest] of Object.entries(exported.inputs))
  if ((await sha256(await raw(path))) !== digest) {
    if (!planningFromFrozen)
      throw Error(`Stale ordinary reconstruction: ${path}`);
    historicalSourceDrift.push({
      path,
      historicalSha256: digest,
      currentSha256: inputs[resolve(path)],
    });
  }
const report = exported.report,
  scene = await read(`${cache}/public/latest-scene/manifest.json`),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  manifestBytes = await load("latest-effects/manifest.json"),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  extension = await read(
    `${cache}/public/latest-gear-effect-extension/package.json`,
  ),
  compiler = await read(
    `${cache}/research/gear-effect-extension/compiled-frontier-v35.json`,
  );
for (const [path, digest] of Object.entries(compiler.inputs))
  if ((await sha256(await raw(path))) !== digest)
    throw Error(`Stale compiler frontier: ${path}`);
const prefix = await createLatestPositiveFormResourcePrefix({
    profile,
    packageBytes: await load(
      "latest-positive-form-resource-prefix/package.json",
    ),
    effectsManifestBytes: manifestBytes,
    gearPackageBytes: await load("latest-unit-gear-resources/package.json"),
  }),
  track = prefix.createTrack(report),
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
    manifestBytes,
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
  definitions = {};
for (const name of ["motion", "controllers", "actors"])
  definitions[name] = await read(
    `${cache}/public/decoder-16.21-macos/missile-${name}.json`,
  );
const subjects = [];
for (const hero of report.heroes)
  subjects.push({
    entityId: hero.entityId,
    character: hero.champion,
    catalog: await read(
      `${cache}/public/latest-scene/${scene.champions[`${hero.champion.toLowerCase()}/${hero.skinId}`].spellCatalog}`,
    ),
  });
const byId = new Map(subjects.map((row) => [row.entityId, row])),
  controllers = createLatestMissileControllers(definitions.controllers),
  motion = createLatestMissileMotion(definitions.motion),
  actors = createLatestMissileActors(definitions.actors),
  initialization = createLatestMissileInitialization(definitions.controllers),
  frame = createLatestMissileFrame(
    definitions.controllers,
    motion,
    controllers,
    terrain,
  ),
  analysis = analyzeLatestMissiles(report, subjects, definitions.motion, {
    manifest: scene,
    terrain,
    controllers,
    initialization,
    frame,
    actors,
  }),
  fixed = new Map(
    prepareFixedTimeRecords({
      report,
      subjects,
      motionDefinition: definitions.motion,
      initialization,
      terrain,
    }).map((row) => [row.sequence, row]),
  ),
  rows = [];
for (const base of analysis.records.filter(
  (row) => row.time >= 69 && row.time <= 99,
)) {
  const cursor = {
      transportSequence: base.transportSequence,
      entryOrder: base.entryOrder ?? 0,
    },
    binding = bindLatestMissileSpell(base, byId),
    hero = report.heroes.find((row) => row.entityId === base.cast.ownerId),
    actorKey = hero
      ? `champions/${hero.champion.toLowerCase()}/${hero.skinId}`
      : null;
  if (!extension.resources.some((entry) => entry.actorKey === actorKey))
    continue;
  const keyText = binding.spell?.data.mMissileEffectKey;
  if (typeof keyText !== "string")
    throw Error("Typed authored missile resource key required");
  const key = parseInt(gearMetaHash(keyText), 16),
    lookup = track.lookup(base.cast.ownerId, base.time, key, cursor),
    referenceToken = lookup.referenceToken,
    definitionId = Number.isInteger(referenceToken)
      ? `${actorKey}/${referenceToken.toString(16).padStart(8, "0")}`
      : null,
    candidate = compiler.definitions.find((row) => row.id === definitionId),
    row = fixed.get(base.sequence) ?? base,
    spec = binding.spell.data.mMissileSpec,
    caster = world.entity(base.cast.ownerId, base.time, cursor),
    targets = base.cast.requestedTargets.map((target) => ({
      requestedEntityId: target.requestedEntityId,
      view: world.presentationTarget(
        target.requestedEntityId,
        base.time,
        cursor,
      ),
    })),
    identity = analysis.eventIndex.identities.find(
      (entry) => entry.entityId === base.entityId,
    );
  rows.push({
    sourceEventId: `packet:${base.transportSequence}:entry:${base.entryOrder ?? 0}:missile:${base.entityId}`,
    sequence: base.sequence,
    transportSequence: base.transportSequence,
    entryOrder: base.entryOrder ?? 0,
    time: base.time,
    ownerId: base.cast.ownerId,
    entityId: base.entityId,
    actorKey,
    spellHash: base.cast.spellHash,
    spellName: binding.spell.name,
    resourceKey: key,
    baseDefinitionId:
      manifest.actors[actorKey].missiles[base.cast.spellHash]?.effectId ?? null,
    conditionalResourcePrefix: lookup,
    stagedDefinitionId: definitionId,
    movementType: row.movementType,
    movementSettings: row.settings,
    movementComponent: spec.movementComponent,
    heightSolver: spec.heightSolver ?? null,
    verticalFacing: spec.verticalFacing ?? null,
    behaviorSpecs: spec.behaviors ?? [],
    targetCount: base.cast.targetCount,
    sourceFlags: base.cast.sourceFlags,
    forceRecordedSourcePosition: base.cast.forceRecordedSourcePosition,
    startInitialization: row.startInitialization,
    targetInitialization: row.targetInitialization,
    packetInitialization: row.packetInitialization,
    fixedSpeedFrameAdmission: base.frameAdmission,
    behaviorAdmission: base.phaseAdmission,
    replication: {
      count: identity.replications.length,
      stream: base.stream,
      elapsedSeconds: base.elapsedSeconds,
      pendingChildren: base.pendingChildren,
      replicationPhase: base.replicationPhase,
      initialPresentationByte: base.initialPresentationByte,
      notifications: identity.events.map((event) => ({
        opcode: event.opcode,
        time: event.time,
        transportSequence: event.transportSequence,
        entryOrder: event.entryOrder ?? 0,
        target: event.target,
        value: event.value,
      })),
    },
    caster: caster
      ? {
          position: caster.position,
          positionStatus: caster.positionStatus,
          direction: caster.direction,
          orientationStatus: caster.orientationStatus,
          reasons: caster.reasons,
        }
      : null,
    targets,
    compilerRetained: candidate?.compilerRetained ?? [],
    systemBlockers: candidate?.systemBlockers ?? [
      "gear-extension:definition-not-selected",
    ],
    sourceOmissions: candidate?.omittedEmitters ?? [],
    nativeMaterialAdmitted: 0,
    actualRendered: false,
  });
}
const grouped = Object.fromEntries(
  [...new Set(rows.map((row) => row.spellName))].map((name) => {
    const members = rows.filter((row) => row.spellName === name);
    return [
      name,
      {
        records: members.length,
        sourceEventIds: members.map((row) => row.sourceEventId),
        movementType: members[0].movementType,
        stagedDefinitionIds: [
          ...new Set(members.map((row) => row.stagedDefinitionId)),
        ],
        compilerRetainedComponentInstances: members.reduce(
          (n, row) => n + row.compilerRetained.length,
          0,
        ),
        positiveFirstCountComponentInstances: members.reduce(
          (n, row) =>
            n +
            row.compilerRetained.filter(
              (e) => e.firstCountWithSuppliedClock.count > 0,
            ).length,
          0,
        ),
        nativeMaterialAdmitted: 0,
      },
    ];
  }),
);
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Conjunction input changed: ${path}`);
const result = {
  schema: 1,
  kind: "inactive-gear-missile-capability-conjunctions",
  inputs,
  window: [69, 99],
  grouped,
  rows,
  scope: {
    originalRecordedMissiles: true,
    conditionalResourcePrefixNotCompleteNativeAcceptance: true,
    emissionCountsUseSuppliedTime0Age0Quality1Only: true,
    noCompilerMaterialOrMovementGateWaived: true,
    ordinaryActivationEnabled: false,
    actualRenderedCoverage: false,
    currentOrdinaryReconstructionProof: !planningFromFrozen,
    historicalPlanningOnly: planningFromFrozen,
  },
  historicalSourceDrift,
};
await Bun.write(
  `${cache}/research/gear-effect-extension/missile-conjunctions${planningFromFrozen ? "-historical-planning" : ""}-v35.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(grouped));
