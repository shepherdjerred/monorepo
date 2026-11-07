import {
  createLatestMissileMotion,
  indexLatestMissileEvents,
  bindLatestMissileSpell,
} from "./latest-missiles.mjs";
import { createLatestMissileControllers } from "./latest-missile-controllers.mjs";
import { createLatestMissileInitialization } from "./latest-missile-initialization.mjs";
import { createLatestMissileActors } from "./latest-missile-actors.mjs";
import { createPresentationMissileActors } from "./latest-presentation-missile-actors.mjs";
import { createFixedTimeMovement } from "./latest-fixed-time-movement.mjs";
import { prepareFixedTimeRecords } from "./latest-fixed-time-spec.mjs";
import { buildFixedTimePresentation } from "./latest-fixed-time-presentation.mjs";
import { sha256 } from "./structural-comparison.mjs";
import { createOwnedMissileCasterStarts } from "./latest-missile-caster-context.mjs";
import {
  compileZeroReferenceFixedTimeSpec,
  createZeroReferenceFixedTimeController,
} from "./latest-zero-reference-fixed-time.mjs";
import { buildZeroReferenceFixedTimePresentation } from "./latest-zero-reference-fixed-time-presentation.mjs";

export async function createFixedTimePresentation({
  report,
  scene,
  terrain,
  world,
  profile,
  load,
  endTime,
  includeZeroReference = false,
}) {
  if (typeof includeZeroReference !== "boolean")
    throw Error("Explicit FixedTime family selection required");
  if (
    profile.clientVersion !== report.build ||
    profile.protocolDigest !== report.protocol ||
    profile.decoderImageSha256 !== report.decoderImageSha256 ||
    profile.fieldCodecsSha256 !== report.fieldCodecsSha256 ||
    profile.constructorImageSha256 !== report.constructorImageSha256 ||
    scene.build !== report.build ||
    scene.protocol !== report.protocol
  )
    throw Error("FixedTime static/browser build boundary mismatch");
  const definitions = {};
  for (const [name, key] of [
    ["motion", "missileMotionSha256"],
    ["controllers", "missileControllersSha256"],
    ["actors", "missileActorsSha256"],
  ]) {
    const bytes = await load(`decoder-16.21-macos/missile-${name}.json`);
    if ((await sha256(bytes)) !== profile[key])
      throw Error("FixedTime static numeric package differs");
    definitions[name] = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (definitions[name].decoderImageSha256 !== profile.decoderImageSha256)
      throw Error("FixedTime numeric image differs");
  }
  const subjects = [];
  for (const hero of report.heroes) {
    const asset =
      scene.champions[`${hero.champion.toLowerCase()}/${hero.skinId}`];
    if (!asset) throw Error("FixedTime source catalog missing");
    const catalogBytes = await load(`latest-scene/${asset.spellCatalog}`);
    subjects.push({
      entityId: hero.entityId,
      character: hero.champion,
      catalogSha256: await sha256(catalogBytes),
      catalog: JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(catalogBytes),
      ),
    });
  }
  const controllers = createLatestMissileControllers(definitions.controllers),
    motion = createLatestMissileMotion(definitions.motion),
    initialization = createLatestMissileInitialization(definitions.controllers),
    actors = createPresentationMissileActors(
      createLatestMissileActors(definitions.actors),
    );
  const records = prepareFixedTimeRecords({
    report,
    subjects,
    motionDefinition: definitions.motion,
    initialization,
    terrain,
  });
  const kernel = createFixedTimeMovement(motion, controllers);
  const result = {
    ...buildFixedTimePresentation({
      records,
      eventIndex: indexLatestMissileEvents(report),
      world,
      actors,
      kernel,
      build: report.build,
      protocol: report.protocol,
      endTime,
    }),
    replaySha256: report.replaySha256,
    sourceCounts: {
      decodedMissileRecords: report.missiles.filter(
        (row) => row.time <= endTime,
      ).length,
      fixedTimeRecords: records.filter((row) => row.time <= endTime).length,
    },
  };
  if (!includeZeroReference) return result;
  const byId = new Map(subjects.map((subject) => [subject.entityId, subject]));
  const zeroReferenceRecords = records
    .filter((record) => record.cast.targetCount === 0)
    .map((record) => {
      const binding = bindLatestMissileSpell(record, byId);
      return {
        ...record,
        zeroReferenceSpec: compileZeroReferenceFixedTimeSpec(
          binding.spell.data.mMissileSpec,
          definitions.motion,
        ),
      };
    });
  const casterStarts = await createOwnedMissileCasterStarts({
    report,
    scene,
    profile,
    world,
    terrain,
    records: zeroReferenceRecords,
    load,
  });
  for (const record of zeroReferenceRecords) {
    record.startInitialization = casterStarts.initialize(record);
    record.packetInitialization = initialization.initializeFixedSpeedPacket(
      record,
      record.settings,
      record.startInitialization,
      record.targetInitialization,
      terrain,
    );
  }
  return {
    ...result,
    zeroReferencePresentation: {
      ...buildZeroReferenceFixedTimePresentation({
        records: zeroReferenceRecords,
        eventIndex: indexLatestMissileEvents(report),
        actors,
        controller: createZeroReferenceFixedTimeController({
          kernel,
          initialization,
          terrain,
        }),
        build: report.build,
        protocol: report.protocol,
        endTime,
      }),
      replaySha256: report.replaySha256,
      sourceCounts: {
        decodedMissileRecords: report.missiles.filter(
          (record) => record.time <= endTime,
        ).length,
        fixedTimeRecords: records.filter((record) => record.time <= endTime)
          .length,
      },
    },
  };
}
