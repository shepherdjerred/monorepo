import { sha256 } from "./structural-comparison.mjs";
import { createLatestAnimationRigBindings } from "./latest-animation-rigs.mjs";
import { initializeEmptyBoneCasterStart } from "./latest-missile-caster-start.mjs";
import {
  initializeNamedBoneCasterStart,
  initializeNamedBoneTypeOneCasterStart,
} from "./latest-named-bone-caster-start.mjs";
import { createLatestMissileInitialization } from "./latest-missile-initialization.mjs";
import {
  assertDirectCompiledDataGraph,
  sameDirectCompiledData,
} from "./latest-direct-compiled-restore.mjs";

const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const exact = (a, b) => {
  assertDirectCompiledDataGraph(a);
  assertDirectCompiledDataGraph(b);
  return sameDirectCompiledData(a, b);
};
const unresolved = (reason) => ({
  resolved: false,
  status: "unresolved-caster-terrain-bone-seed",
  position: null,
  reasons: [reason],
});

// Routing predicate only; the owned factory and movement builder retain every
// source, pose, target, lifecycle and controller admission check.
export function collectNamedBoneTypeOneCasterRecords({
  report,
  subjects,
  initialization,
  endTime = report.endTime,
}) {
  if (!Number.isFinite(endTime) || endTime < 0)
    throw Error("Bounded named-source routing time required");
  const byId = new Map(subjects.map((subject) => [subject.entityId, subject]));
  return report.missiles.filter((record) => {
    if (
      record.time > endTime ||
      record.cast.forceRecordedSourcePosition ||
      record.cast.targetCount !== 1 ||
      record.cast.overrideFlag14d !== 0
    )
      return false;
    const owner = byId.get(record.cast.ownerId);
    if (
      !owner ||
      (record.cast.sourceName &&
        record.cast.sourceName.toLowerCase() !== owner.character.toLowerCase())
    )
      return false;
    const spell = owner.catalog.spells[record.cast.spellHash],
      movement = spell?.data.mMissileSpec?.movementComponent;
    return (
      spell?.data.mCastType === 1 &&
      movement?.__type === "FixedSpeedMovement" &&
      (movement.mTracksTarget ?? true) === true &&
      typeof movement.mStartBoneName === "string" &&
      movement.mStartBoneName.length > 0 &&
      (movement.mTargetBoneName ?? "") === "" &&
      initialization
        .settings(spell.data)
        .particleStartOffset.every((lane) => lane === 0)
    );
  });
}

// Own source bytes before exposing a start query. Neither caller-provided rig
// hashes nor mutable replacement records can select the empty-bone path.
export const createOwnedMissileCasterStarts = (options) =>
  createOwnedCasterStarts(options, 0);

// Separate, currently unadmitted named-bone input provider. This owns raw static
// sources and queries the supplied viewer pose; it does not recover the native
// live render-model readiness or admit a movement/presentation family.
export const createOwnedNamedBoneMissileCasterStarts = (options) =>
  createOwnedCasterStarts(options, 3);

// Distinct type1 named source branch for retained-target FixedSpeed movement.
// Its native selector preserves bone XYZ without the type3 ground rebase.
export const createOwnedNamedBoneTypeOneMissileCasterStarts = (options) =>
  createOwnedCasterStarts(options, 1);

async function createOwnedCasterStarts(
  { report, scene, profile, world, terrain, records, load },
  namedCastType,
) {
  const namedBone = namedCastType !== 0;
  assertDirectCompiledDataGraph(report);
  assertDirectCompiledDataGraph(scene);
  assertDirectCompiledDataGraph(records);
  if (
    report.build !== "16.21.829.8620" ||
    report.protocol !== "20e09df23c66b85e" ||
    report.build !== profile.clientVersion ||
    report.protocol !== profile.protocolDigest ||
    report.decoderImageSha256 !== profile.decoderImageSha256 ||
    typeof world?.viewerRoot !== "function" ||
    (namedBone && typeof world?.viewerPose !== "function")
  )
    throw Error("Exact-build owned caster world and static inputs required");
  const inventoryBytes = await load("decoder-16.21-macos/animation-rigs.json");
  const controllerBytes = await load(
    "decoder-16.21-macos/missile-controllers.json",
  );
  if ((await sha256(controllerBytes)) !== profile.missileControllersSha256)
    throw Error("Exact caster start defaults required");
  const initialization = createLatestMissileInitialization(
    decode(controllerBytes),
  );
  const factory = await createLatestAnimationRigBindings(
    profile,
    inventoryBytes,
  );
  const inventory = decode(inventoryBytes),
    sceneBytes = await load("latest-scene/manifest.json");
  if (
    !exact(decode(sceneBytes), scene) ||
    (await sha256(sceneBytes)) !== inventory.sceneManifestSha256
  )
    throw Error("Constructed rig inventory and actual scene differ");
  const sourceRecords = new Map(
    report.missiles.map((record) => [record.sequence, record]),
  );
  const heroes = new Map(report.heroes.map((hero) => [hero.entityId, hero]));
  const sources = new Map(),
    owned = new WeakMap();
  for (const record of records) {
    const original = sourceRecords.get(record.sequence);
    if (
      !original ||
      original.entityId !== record.entityId ||
      original.time !== record.time ||
      original.transportSequence !== record.transportSequence ||
      (original.entryOrder ?? 0) !== (record.entryOrder ?? 0) ||
      original.payloadSha256 !== record.payloadSha256 ||
      !exact(original.cast, record.cast) ||
      (namedBone && !exact(original, record))
    )
      throw Error(
        "Exact original causal missile record required for caster binding",
      );
    if (
      (!namedBone && !record.zeroReferenceSpec?.resolved) ||
      record.cast.forceRecordedSourcePosition ||
      record.cast.targetCount !== (namedCastType === 1 ? 1 : 0)
    ) {
      owned.set(record, {
        reason:
          namedCastType === 1
            ? "start:outside-verified-named-type1-single-target-family"
            : "start:outside-verified-zero-reference-caster-family",
      });
      continue;
    }
    const hero = heroes.get(record.cast.ownerId);
    if (!hero) throw Error("Actual decoded caster appearance required");
    const actorKey = `${hero.champion.toLowerCase()}/${hero.skinId}`;
    if (!sources.has(actorKey)) {
      const asset = scene.champions[actorKey];
      const source = inventory.graphs[asset?.animationGraph];
      if (
        !asset ||
        !source ||
        source.actor !== `champions/${actorKey}` ||
        source.catalogFile !== asset.animationCatalog
      )
        throw Error("Exact source appearance constructed rig required");
      const rigBytes = await load(`latest-scene/${source.rigFile}`),
        catalogBytes = await load(`latest-scene/${source.catalogFile}`),
        spellBytes = await load(`latest-scene/${asset.spellCatalog}`);
      const installed = await factory.bind(
        asset.animationGraph,
        rigBytes,
        catalogBytes,
      );
      const spells = decode(spellBytes);
      if (spells.character !== hero.champion)
        throw Error("Exact source caster spell catalog required");
      sources.set(
        actorKey,
        Object.freeze({
          build: report.build,
          protocol: report.protocol,
          rigSha256: source.rigSha256,
          resolvedBoneKeys: Object.freeze(
            source.joints.map((joint) => joint.resolvedBoneKey),
          ),
          spells,
          installed,
          provenance: Object.freeze({
            actorKey,
            graphFile: asset.animationGraph,
            rigFile: source.rigFile,
            rigSha256: source.rigSha256,
            catalogFile: source.catalogFile,
            catalogSha256: source.catalogSha256,
            inventorySha256: await sha256(inventoryBytes),
            spellCatalogFile: asset.spellCatalog,
            spellCatalogSha256: await sha256(spellBytes),
            rawRigAndCatalogVerified: true,
          }),
        }),
      );
    }
    const rig = sources.get(actorKey),
      spell = rig.spells.spells[original.cast.spellHash];
    if (
      !spell ||
      spell.data.mMissileSpec?.movementComponent?.__type !==
        (namedBone ? "FixedSpeedMovement" : "FixedTimeMovement")
    )
      throw Error("Exact source caster movement spell required");
    const settings = initialization.settings(spell.data),
      sourceBoneName =
        spell.data.mMissileSpec.movementComponent.mStartBoneName ?? "";
    if (
      namedCastType === 1 &&
      (settings.castType !== 1 ||
        (record.cast.sourceName &&
          record.cast.sourceName.toLowerCase() !== hero.champion.toLowerCase()))
    ) {
      owned.set(record, {
        reason: "start:source-type1-spell-owner-unresolved",
      });
      continue;
    }
    if (
      !namedBone &&
      (!exact(settings, record.startInitialization.settings) ||
        sourceBoneName !== record.sourceBoneName)
    )
      throw Error("Prepared caster settings differ from owned source spell");
    const binding =
      namedBone && sourceBoneName.length
        ? rig.installed.resolve(sourceBoneName)
        : null;
    if (namedBone && binding?.status !== "rig-joint") {
      owned.set(record, {
        reason: "start:installed-source-named-bone-unresolved",
      });
      continue;
    }
    owned.set(record, {
      record: structuredClone(original),
      rig,
      settings,
      sourceBoneName,
      binding,
    });
  }
  return Object.freeze({
    initialize(record) {
      const source = owned.get(record);
      if (!source) throw Error("Owned prepared caster record required");
      assertDirectCompiledDataGraph(record);
      if (source.reason) return unresolved(source.reason);
      const original = source.record;
      if (
        record.entityId !== original.entityId ||
        record.time !== original.time ||
        record.transportSequence !== original.transportSequence ||
        (record.entryOrder ?? 0) !== (original.entryOrder ?? 0) ||
        !exact(record.cast, original.cast) ||
        (namedBone && !exact(record, original))
      )
        throw Error("Owned caster causal input changed after source binding");
      const root = world.viewerRoot(original.cast.ownerId, original.time, {
        transportSequence: original.transportSequence,
        entryOrder: original.entryOrder ?? 0,
      });
      const namedInputs = namedBone
        ? {
            pose: world.viewerPose(
              original.cast.ownerId,
              [source.binding.resolvedBoneKey],
              original.time,
              {
                transportSequence: original.transportSequence,
                entryOrder: original.entryOrder ?? 0,
              },
            ),
          }
        : {};
      const result = (
        namedBone
          ? namedCastType === 1
            ? initializeNamedBoneTypeOneCasterStart
            : initializeNamedBoneCasterStart
          : initializeEmptyBoneCasterStart
      )({
        record: original,
        settings: source.settings,
        sourceBoneName: source.sourceBoneName,
        root,
        rig: namedBone
          ? {
              build: source.rig.build,
              protocol: source.rig.protocol,
              actorKey: source.rig.provenance.actorKey,
              rigSha256: source.rig.rigSha256,
              binding: source.binding,
            }
          : source.rig,
        terrain,
        ...namedInputs,
      });
      return { ...result, sourceRig: structuredClone(source.rig.provenance) };
    },
    scope: Object.freeze({
      sourceBoundInstalledRig: true,
      exactCreationCursor: true,
      nativeMatchRootRecovered: false,
      ...(namedBone
        ? {
            suppliedViewerPose: true,
            nativeMatchPoseRecovered: false,
            nativeLiveModelReady: false,
            activeFamilyAdmission: namedCastType === 1,
          }
        : {}),
    }),
  });
}
