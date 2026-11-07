import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
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
import { bindLatestMissileEffects } from "../latest-effects.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { createLatestWorldPresentation } from "../latest-world-presentation.mjs";
import { loadLatestInitialResourcePrefix } from "../latest-initial-resource-prefix.mjs";
import { loadLatestViewerPoseAssets } from "../latest-viewer-pose-assets.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { buildLatestDirectMissilePresentation } from "../latest-direct-missile-presentation.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const raw = async (path) => {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Changed input: ${path}`);
  inputs[path] = hash;
  return bytes;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], raw);
const exported = await read(
  `${cache}/research/viewer-root-reconstruction.json`,
);
if (
  exported.runtimePlaybackInput !== false ||
  exported.kind !== "verified-ordinary-reconstruction-diagnostic-export"
)
  throw Error("Ordinary reconstruction diagnostic required");
for (const [path, hash] of Object.entries(exported.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error(`Stale reconstruction: ${path}`);
if (
  (await sha256(await raw(exported.controlReportPath))) !==
  exported.controlReportSha256
)
  throw Error("Reconstruction control changed");
const control = await read(exported.controlReportPath),
  report = exported.report;
if (
  report.endTime !== 99 ||
  report.build !== "16.21.829.8620" ||
  report.protocol !== "20e09df23c66b85e"
)
  throw Error("Exact 99 second comparison prefix required");
const scene = await read(`${cache}/public/latest-scene/manifest.json`);
const heightBytes = await load("latest-scene/heights.bin");
const terrain = createLatestTerrain(
  scene,
  new Float32Array(
    heightBytes.buffer,
    heightBytes.byteOffset,
    heightBytes.byteLength / 4,
  ),
);
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
const manifestBytes = await load("latest-effects/manifest.json"),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
const initial = await loadLatestInitialResourcePrefix({
  profile,
  report,
  manifestBytes,
  load,
});
const viewerPoseAssets = await loadLatestViewerPoseAssets({
  profile,
  report,
  scene,
  load,
});
const world = createLatestWorldPresentation({
  report,
  scene,
  terrain,
  initialResourcePrefix: initial.policy,
  viewerPoseAssets,
});
const definitions = {};
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
const byId = new Map(subjects.map((row) => [row.entityId, row]));
const controllers = createLatestMissileControllers(definitions.controllers),
  motion = createLatestMissileMotion(definitions.motion),
  initialization = createLatestMissileInitialization(definitions.controllers),
  actors = createLatestMissileActors(definitions.actors),
  frame = createLatestMissileFrame(
    definitions.controllers,
    motion,
    controllers,
    terrain,
  );
const analysis = analyzeLatestMissiles(report, subjects, definitions.motion, {
  manifest: scene,
  terrain,
  controllers,
  initialization,
  frame,
  actors,
});
const legacy = buildLatestDirectMissilePresentation({
  report,
  analysis,
  manifest,
  frame,
  actors,
  endTime: 99,
});
const legacyTraces = new Map(legacy.traces.map((row) => [row.sequence, row]));
const legacyOmitted = new Map(legacy.omitted.map((row) => [row.sequence, row]));
const fixedTime = new Map(
  prepareFixedTimeRecords({
    report,
    subjects,
    motionDefinition: definitions.motion,
    initialization,
    terrain,
  }).map((row) => [row.sequence, row]),
);
const bindingRows = bindLatestMissileEffects(report, manifest).records;
const bindings = new Map(bindingRows.map((row) => [row.sequence, row]));
const prepared = await loadLatestDirectEffectPackage({
  load,
  manifestBytes,
  effectIds: bindingRows
    .filter((row) => row.status === "prepared-definition")
    .map((row) => row.effectId),
});
const traces = new Map(
  control.missileFamiliesControl.traces.map((row) => [row.sequence, row]),
);
const omitted = new Map(
  control.missileFamiliesControl.omitted.map((row) => [row.sequence, row]),
);
const inWindow = (row) => row.time >= 69 && row.time <= 99;
const sourceId = (row) =>
  `packet:${row.transportSequence}:entry:${row.entryOrder ?? 0}:missile:${row.entityId}`;
const rows = analysis.records.filter(inWindow).map((base) => {
  const row = fixedTime.get(base.sequence) ?? base,
    binding = bindings.get(row.sequence),
    trace = traces.get(row.sequence),
    legacyTrace = legacyTraces.get(row.sequence),
    omit = omitted.get(row.sequence),
    spec = bindLatestMissileSpell(row, byId).spell?.data.mMissileSpec;
  const cursor = {
    transportSequence: row.transportSequence,
    entryOrder: row.entryOrder ?? 0,
  };
  const caster = world.entity(row.cast.ownerId, row.time, cursor);
  const sourceBoneName = spec?.movementComponent?.mStartBoneName ?? "";
  const boneBinding = sourceBoneName
    ? viewerPoseAssets
        .actor(row.cast.ownerId)
        ?.bindings.find(
          (binding) =>
            binding.name.toLowerCase() === sourceBoneName.toLowerCase(),
        )
    : null;
  const bone = sourceBoneName
    ? boneBinding
      ? world.viewerPose(
          row.cast.ownerId,
          [boneBinding.resolvedBoneKey],
          row.time,
          cursor,
        )
      : {
          resolved: false,
          reasons: ["pose:source-bone-name-not-installed"],
          sourceBoneName,
        }
    : null;
  const compiled =
    binding.status === "prepared-definition"
      ? prepared.definitions.get(binding.effectId)
      : null;
  return {
    sourceEventId: sourceId(row),
    sequence: row.sequence,
    entityId: row.entityId,
    time: row.time,
    ownerId: row.cast.ownerId,
    champion: row.ownerCharacter,
    definitionName: row.definitionName,
    spellHash: row.cast.spellHash,
    effectId: binding.effectId ?? null,
    resourceStatus: binding.status,
    movementType: row.movementType,
    tracksTarget: row.settings?.mTracksTarget ?? null,
    forceRecordedSourcePosition: row.cast.forceRecordedSourcePosition,
    requestedTargetIds: row.cast.requestedTargets.map(
      (target) => target.requestedEntityId,
    ),
    sourceBoneName,
    sourceFlags: row.cast.sourceFlags,
    startInitialization: row.startInitialization,
    packetStatus: row.packetInitialization.status,
    family: trace?.policy ?? null,
    familyStopTime: trace?.stopTime ?? null,
    legacyPolicy: legacyTrace ? legacy.policy : null,
    legacyStopTime: legacyTrace?.stopTime ?? null,
    movementReady: !!(trace || legacyTrace),
    movementReasons:
      trace || legacyTrace
        ? []
        : [
            ...new Set([
              ...(omit?.reasons ?? []),
              ...(legacyOmitted.get(row.sequence)?.reasons ?? []),
            ]),
          ],
    legacyFrameReasons: base.frameAdmission.reasons,
    behaviorReasons: base.phaseAdmission.reasons,
    casterView: caster
      ? {
          entityClass: caster.entityClass,
          position: caster.position,
          positionStatus: caster.positionStatus,
          direction: caster.direction,
          orientationStatus: caster.orientationStatus,
          reasons: caster.reasons,
        }
      : null,
    sourceBoneView: bone,
    compiledEmitters:
      compiled?.emitters.map((e) => ({
        index: e.index,
        primitive: e.primitive,
        placementRequirements: e.placementRequirements,
      })) ?? [],
    unsupported: compiled?.unsupported ?? [],
    systemBlockers: compiled?.blockers ?? [],
    systemOmissions: compiled?.systemOmissions ?? [],
  };
});
const count = (source, key) =>
  Object.fromEntries(
    [...new Set(source.map(key))].map((value) => [
      value,
      source.filter((row) => key(row) === value).length,
    ]),
  );
const reasons = {};
for (const row of rows)
  for (const reason of row.movementReasons) {
    const entry = (reasons[reason] ??= {
      records: 0,
      champions: {},
      sourceEventIds: [],
    });
    entry.records++;
    entry.champions[row.champion] = (entry.champions[row.champion] ?? 0) + 1;
    entry.sourceEventIds.push(row.sourceEventId);
  }
const heroes = new Map(
  report.heroes.map((row) => [row.entityId, row.champion]),
);
const attacks = report.attacks
  .filter(inWindow)
  .filter((row) => heroes.has(row.entityId));
const casts = report.casts
  .filter(inWindow)
  .filter((row) => heroes.has(row.ownerId));
const eventRows = (events, entityKey) =>
  events.map((row) => ({
    sourceEventId: `packet:${row.transportSequence}:entry:${row.entryOrder ?? 0}:${row.kind}:${row[entityKey]}`,
    champion: heroes.get(row[entityKey]),
    time: row.time,
    sequence: row.sequence,
    spellHash: row.spellHash ?? null,
    castSequence: row.castSequence,
    targetId: row.targetId ?? null,
    targetCount: row.targetCount ?? null,
  }));
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Input changed during frontier capture: ${path}`);
const result = {
  schema: 1,
  kind: "actual-projectile-family-frontier",
  build: report.build,
  protocol: report.protocol,
  replaySha256: report.replaySha256,
  comparisonWindow: [69, 99],
  inputs,
  counts: {
    missileRecords: rows.length,
    heroAttacks: attacks.length,
    heroCasts: casts.length,
    movementFamiliesReady: rows.filter((row) => row.family).length,
    legacyMovementReady: rows.filter((row) => row.legacyPolicy).length,
    eitherMovementReady: rows.filter((row) => row.movementReady).length,
    resourcesPrepared: rows.filter(
      (row) => row.resourceStatus === "prepared-definition",
    ).length,
  },
  perChampion: Object.fromEntries(
    report.heroes.map((hero) => [
      hero.champion,
      {
        missileRecords: rows.filter((row) => row.champion === hero.champion)
          .length,
        heroAttacks: attacks.filter((row) => row.entityId === hero.entityId)
          .length,
        heroCasts: casts.filter((row) => row.ownerId === hero.entityId).length,
        familiesReady: rows.filter(
          (row) => row.champion === hero.champion && row.family,
        ).length,
      },
    ]),
  ),
  movementTypes: count(rows, (row) => row.movementType),
  resourceStatuses: count(rows, (row) => row.resourceStatus),
  movementBlockers: Object.fromEntries(
    Object.entries(reasons).sort((a, b) => b[1].records - a[1].records),
  ),
  missiles: rows,
  heroAttacks: eventRows(attacks, "entityId"),
  heroCasts: eventRows(casts, "ownerId"),
  scope: {
    actualDecodedReplayRequests: true,
    attackCastMissileCategoriesOverlap: true,
    localStaticCompilation: true,
    movementNativeAcceptance: null,
    sourceBonePresenceDoesNotEstablishNativeStartSelection: true,
    proposedAdmission: false,
    productionCodeChanged: false,
    browserPlaybackObserved: false,
  },
};
const output = `${cache}/research/projectile-family-frontier.json`;
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    {
      output,
      counts: result.counts,
      perChampion: result.perChampion,
      movementTypes: result.movementTypes,
      resourceStatuses: result.resourceStatuses,
      blockers: Object.fromEntries(
        Object.entries(result.movementBlockers).map(([key, value]) => [
          key,
          { records: value.records, champions: value.champions },
        ]),
      ),
    },
    null,
    2,
  ),
);
