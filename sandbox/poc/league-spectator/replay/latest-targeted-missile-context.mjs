import {
  analyzeLatestMissiles,
  bindLatestMissileSpell,
  createLatestMissileMotion,
} from "./latest-missiles.mjs";
import { createLatestMissileControllers } from "./latest-missile-controllers.mjs";
import { createLatestMissileInitialization } from "./latest-missile-initialization.mjs";
import { createLatestMissileFrame } from "./latest-missile-frame.mjs";
import { createLatestMissileActors } from "./latest-missile-actors.mjs";
import { createPresentationMissileActors } from "./latest-presentation-missile-actors.mjs";
import { buildTargetedMissilePresentation } from "./latest-targeted-missile-presentation.mjs";
import { sha256 } from "./structural-comparison.mjs";
import {
  createOwnedNamedBoneTypeOneMissileCasterStarts,
  collectNamedBoneTypeOneCasterRecords,
} from "./latest-missile-caster-context.mjs";
import { NAMED_BONE_TYPE_ONE_CASTER_START_POLICY } from "./latest-named-bone-caster-start.mjs";
import { compileTrackingFixedSpeedEffectBasisProgram } from "./latest-missile-effect-basis.mjs";

export async function createTargetedMissilePresentation({
  report,
  scene,
  terrain,
  world,
  profile,
  load,
  endTime,
}) {
  if (
    profile.clientVersion !== report.build ||
    profile.protocolDigest !== report.protocol ||
    profile.decoderImageSha256 !== report.decoderImageSha256 ||
    profile.fieldCodecsSha256 !== report.fieldCodecsSha256 ||
    profile.constructorImageSha256 !== report.constructorImageSha256 ||
    scene.build !== report.build ||
    scene.protocol !== report.protocol
  )
    throw Error("Targeted browser/static build boundary mismatch");
  const definitions = {};
  for (const [name, key] of [
    ["motion", "missileMotionSha256"],
    ["controllers", "missileControllersSha256"],
    ["actors", "missileActorsSha256"],
  ]) {
    const bytes = await load(`decoder-16.21-macos/missile-${name}.json`);
    if ((await sha256(bytes)) !== profile[key])
      throw Error("Targeted static kernel package mismatch");
    definitions[name] = JSON.parse(new TextDecoder().decode(bytes));
    if (definitions[name].decoderImageSha256 !== profile.decoderImageSha256)
      throw Error("Targeted numeric kernel image differs");
  }
  const subjects = [];
  for (const hero of report.heroes) {
    const asset =
      scene.champions[`${hero.champion.toLowerCase()}/${hero.skinId}`];
    if (!asset) throw Error("Targeted owner catalog missing");
    const catalogBytes = await load(`latest-scene/${asset.spellCatalog}`);
    subjects.push({
      entityId: hero.entityId,
      character: hero.champion,
      catalog: JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(catalogBytes),
      ),
      catalogSha256: await sha256(catalogBytes),
    });
  }
  const controllers = createLatestMissileControllers(definitions.controllers),
    motion = createLatestMissileMotion(definitions.motion),
    initialization = createLatestMissileInitialization(definitions.controllers),
    baseActors = createLatestMissileActors(definitions.actors),
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
    actors: baseActors,
  });
  const byId = new Map(subjects.map((row) => [row.entityId, row]));
  const sourceRecords = new Map(
    collectNamedBoneTypeOneCasterRecords({
      report,
      subjects,
      initialization,
      endTime,
    }).map((record) => [record.sequence, record]),
  );
  const namedCandidates = analysis.records.filter(
    (record) =>
      sourceRecords.has(record.sequence) &&
      record.packetInitialization.status ===
        "unresolved-caster-terrain-bone-seed",
  );
  if (namedCandidates.length) {
    const records = namedCandidates.map((record) =>
        sourceRecords.get(record.sequence),
      ),
      starts = await createOwnedNamedBoneTypeOneMissileCasterStarts({
        report,
        scene,
        profile,
        world,
        terrain,
        records,
        load,
      });
    for (let index = 0; index < namedCandidates.length; index++) {
      const record = namedCandidates[index],
        start = starts.initialize(records[index]);
      record.startInitialization = start;
      record.packetInitialization = initialization.initializeFixedSpeedPacket(
        record,
        record.settings,
        start,
        record.targetInitialization,
        terrain,
      );
      record.namedCasterStartPresentation = start;
    }
  }
  for (const record of analysis.records) {
    const binding = bindLatestMissileSpell(record, byId),
      spec = binding.spell?.data.mMissileSpec;
    if (
      record.namedCasterStartPresentation?.resolved === true &&
      record.namedCasterStartPresentation.policy ===
        NAMED_BONE_TYPE_ONE_CASTER_START_POLICY
    ) {
      record.effectBasisProgram = compileTrackingFixedSpeedEffectBasisProgram(
        binding.spell.data,
        {
          spellHash: record.cast.spellHash,
          spellName: binding.spell.name,
          catalogSha256: byId.get(record.cast.ownerId).catalogSha256,
        },
      );
    }
    // Original reflection registers mTargetBoneName at spec+18 (length+20),
    // while mStartBoneName is the distinct source attachment string at+30.
    // The original default constructor clears target length+20; authored null
    // or another malformed value must not become the empty default.
    record.targetBoneName = spec?.movementComponent
      ? Object.hasOwn(spec.movementComponent, "mTargetBoneName")
        ? spec.movementComponent.mTargetBoneName
        : ""
      : null;
    record.verticalFacingProperties = Object.keys(
      spec?.verticalFacing ?? {},
    ).filter((key) => key !== "__type");
  }
  const result = buildTargetedMissilePresentation({
    analysis,
    world,
    frame,
    motion,
    actors: createPresentationMissileActors(baseActors),
    endTime,
  });
  return {
    ...result,
    sourceCounts: {
      decodedMissileRecords: report.missiles.filter(
        (row) => row.time <= endTime,
      ).length,
      requestedSingleTargetTrackingRecords: analysis.records.filter(
        (row) =>
          row.time <= endTime &&
          row.movementType === "FixedSpeedMovement" &&
          row.settings?.mTracksTarget === true &&
          row.cast.targetCount === 1,
      ).length,
    },
    replaySha256: report.replaySha256,
  };
}
