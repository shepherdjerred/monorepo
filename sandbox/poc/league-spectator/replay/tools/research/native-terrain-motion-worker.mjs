import { decompress } from "scout-terrain-fzstd";
import { prepareReplayForSeek } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/prepare.mjs";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";
import { createCurrentChampionAnimationCueAccumulator } from "./native-terrain-animation-cue-reader.mjs";
import {
  indexChampionAnimationActions,
  selectChampionAnimations,
} from "./native-terrain-animation-model-selector.mjs";
import { createCurrentMap11AnnouncerCollector } from "./native-terrain-announcer-reader.mjs";
import {
  createPreparedTerrainByteCodecs,
  currentTerrainPositionBuild,
  recoverTerrainByteSubstitution,
} from "./native-terrain-byte-codecs.mjs";
import { bindNativeTerrainChampionIdentities } from "./native-terrain-champion-identities.mjs";
import { prepareCurrentChampionModelBindings } from "./native-terrain-champion-opening.mjs";
import { prepareNativeTerrainChampionKeyframes } from "./native-terrain-champion-keyframes.mjs";
import { createCurrentReplayInhibitorCollector } from "./native-terrain-inhibitor-worker.mjs";
import { createCurrentReplayNexusCollector } from "./native-terrain-nexus-worker.mjs";
import { createCurrentReplayTurretCollector } from "./native-terrain-turret-worker.mjs";
import {
  createCurrentMap11ControllerObserver,
  verifyCurrentMap11ControllerGraph,
} from "./native-terrain-controller-visibility.mjs";
import { prepareNativeTerrainMotion } from "./native-terrain-motion.mjs";
import { createMoveSpeed309ReaderFromCodecs } from "./native-terrain-move-speed-reader.mjs";
import { readCurrentRecordedPlayerState } from "./native-terrain-player-state.mjs";
import { createPosition944ReaderFromCodecs } from "./native-terrain-positions-944-reader.mjs";
import { createWaypointReaderFromCodecs } from "./native-terrain-waypoints-reader.mjs";
import { verifyRecordedChampionExperienceFooter } from "./recorded-champion-experience-tracks.mjs";
import { createRecordedInventoryCollector } from "./recorded-inventory-packets.mjs";
import { createCurrentNeutralObjectiveCollector } from "./recorded-current-neutral-objectives.mjs";
import {
  prepareCurrentNeutralObjectiveScene,
  readCurrentNeutralCampSkins,
  readCurrentNeutralObjectiveModelIds,
} from "./recorded-current-neutral-objective-scene.mjs";
import { createCurrentLaneMinionCollector } from "./recorded-lane-minion-tracks.mjs";
import { createCurrentRecordedTeamVisionCollector } from "./recorded-team-vision.mjs";

function* observeMotionPackets(packets, observe) {
  // Motion may stop after the game clock. Keep ownership of the underlying
  // iterator so the collectors can still read the remaining physical packets.
  for (let next = packets.next(); !next.done; next = packets.next()) {
    observe(next.value);
    yield next.value;
  }
}

function cacheLastWaypoints(read) {
  let previousPayload;
  let previousOpcode;
  let previousResult;
  return (opcode, payload) => {
    if (opcode !== previousOpcode || payload !== previousPayload) {
      previousResult = read(opcode, payload);
      previousOpcode = opcode;
      previousPayload = payload;
    }
    return previousResult;
  };
}

const laneModelId = /^sru_(?:order|chaos)minion(?:melee|ranged|siege|super)$/;
const laneVariants = ["melee", "ranged", "siege", "super"];

function readLaneBarracksTeam(row) {
  if (
    row === null ||
    typeof row !== "object" ||
    Object.keys(row).length !== 2 ||
    !Array.isArray(row.transform) ||
    row.transform.length !== 4 ||
    row.transform.some(
      (axis) =>
        !Array.isArray(axis) ||
        axis.length !== 4 ||
        !axis.every(Number.isFinite),
    ) ||
    row.units === null ||
    typeof row.units !== "object" ||
    Object.keys(row.units).length !== 4
  )
    throw Error("Invalid authored lane minion barracks placement.");
  const team = /^sru_(order|chaos)minionmelee\/0$/.exec(
    row.units[4]?.asset,
  )?.[1];
  if (
    team === undefined ||
    laneVariants.some((variant, index) => {
      const unit = row.units[index + 4];
      return (
        unit === null ||
        typeof unit !== "object" ||
        Object.keys(unit).length !== 1 ||
        unit.asset !== `sru_${team}minion${variant}/0`
      );
    })
  )
    throw Error("Invalid authored lane minion barracks units.");
  return team;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function readLaneModelIds(catalog) {
  if (typeof catalog !== "object" || Object.keys(catalog).length !== 2)
    throw Error("Invalid authored lane minion catalog.");
  const { barracksPlacements, models } = catalog;
  if (
    !Array.isArray(barracksPlacements) ||
    barracksPlacements.length !== 6 ||
    !Array.isArray(models) ||
    models.length !== 8
  )
    throw Error("Invalid authored lane minion catalog.");
  const teams = barracksPlacements.map(readLaneBarracksTeam);
  if (teams.filter((team) => team === "order").length !== 3)
    throw Error("Invalid authored Map11 lane minion teams.");
  if (
    (await sha256Hex(
      new TextEncoder().encode(JSON.stringify(barracksPlacements)),
    )) !== "4a2ba16f5b7210953c6d3aede1ac77a1652b169aa090c2d6da93290821a9b703"
  )
    throw Error("Authored Map11 lane minion barracks digest differs.");
  const ids = new Map();
  const used = new Set();
  for (const row of models) {
    if (!Array.isArray(row) || row.length !== 2)
      throw Error("Invalid authored lane minion model binding.");
    const [modelId, participantId] = row;
    if (
      typeof modelId !== "string" ||
      !laneModelId.test(modelId) ||
      !Number.isSafeInteger(participantId) ||
      participantId <= 0 ||
      ids.has(modelId) ||
      used.has(participantId)
    )
      throw Error("Invalid authored lane minion model binding.");
    ids.set(modelId, participantId);
    used.add(participantId);
  }
  return ids;
}

function finishLaneMinions(lane, modelIds) {
  const { instances, coverage } = lane.finish();
  const laneMinionInstances = instances.map(
    ({
      context,
      modelId,
      team,
      creationTimeSeconds,
      killTimeSeconds,
      paths,
    }) => {
      const participantId = modelIds.get(modelId);
      if (participantId === undefined)
        throw Error("Recorded lane minion has no authenticated model.");
      return {
        context,
        participantId,
        teamId: team,
        creationTimeSeconds,
        killTimeSeconds,
        paths,
      };
    },
  );
  return { laneMinionInstances, laneMinionCoverage: coverage };
}

function readPreparedChampionAnimationActors(binding, catalog) {
  const verified = new Set(binding.verified.map(({ context }) => context));
  if (
    !Array.isArray(catalog) ||
    catalog.length === 0 ||
    catalog.length > verified.size
  )
    throw Error("Invalid champion animation catalog.");
  const actors = new Map();
  for (const { participantId, model, actions } of catalog) {
    if (
      !verified.has(participantId) ||
      actors.has(participantId) ||
      typeof model !== "string" ||
      !/^\/champion-models\/[a-f0-9]{64}\.glb$/u.test(model) ||
      !Array.isArray(actions) ||
      actions.length === 0
    )
      throw Error(
        "Champion animation catalog needs verified distinct actors and models.",
      );
    actors.set(participantId, {
      model,
      actions: indexChampionAnimationActions(actions),
    });
  }
  return actors;
}

function createChampionAnimationCollector(replay, codecs, actors) {
  const accumulator = createCurrentChampionAnimationCueAccumulator(
    replay,
    recoverTerrainByteSubstitution(codecs),
    actors,
  );
  let context = 0;
  let opcode;
  return {
    observe(packet) {
      if (packet.blockOffset === 0) {
        context = 0;
        opcode = undefined;
      }
      opcode = packet.explicitOpcode ?? opcode;
      context =
        packet.marker & 32
          ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
          : packet.paramBits;
      if (packet.stream === 1 && opcode === 669)
        accumulator.observe(context, packet.timeSeconds, packet.payload);
    },
    finish: accumulator.finish,
  };
}

function readAnnouncerEventMapping(entries) {
  if (
    !Array.isArray(entries) ||
    entries.length === 0 ||
    entries.length > 0xffff
  )
    throw Error("Expected a nonempty announcer event mapping.");
  const events = new Map();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2)
      throw Error("Invalid announcer event mapping entry.");
    const [event, mediaId] = entry;
    if (
      !Number.isInteger(event) ||
      event <= 0 ||
      event > 0xffff ||
      !Number.isInteger(mediaId) ||
      mediaId <= 0 ||
      mediaId > 0xffffffff ||
      events.has(event)
    )
      throw Error(
        "Announcer event mapping requires unique event IDs and valid media IDs.",
      );
    events.set(event, mediaId);
  }
  return events;
}

async function prepareMotion({
  identity,
  waypointOrigin,
  replayBytes,
  decoderBytes,
  allowCurrentBuild = false,
  decodeChampionStats,
  decodePlayerState,
  decodeChampionInventory,
  decodeChampionExperience,
  championAnimationCatalog,
  championAnimationModelCatalog,
  championModelCatalog,
  announcerEvents,
  decodeTeamVision,
  teamVisionWorldActors,
  laneMinionCatalog,
  neutralObjectiveModels,
  decodeNeutralCamps,
  neutralCampSkins,
  inhibitorCatalog,
  turretCatalog,
  nexusCatalog,
  terrainControllerGraph,
}) {
  if (
    !(replayBytes instanceof ArrayBuffer) ||
    !(decoderBytes instanceof ArrayBuffer)
  )
    throw new Error("Replay motion needs replay and decoder bytes.");
  const sha256 = await sha256Hex(replayBytes);
  if (identity?.replaySha256 !== sha256)
    throw new Error("Replay motion SHA-256 differs from the scene.");
  const replay = openReplay(replayBytes);
  if (
    replay.build !== identity.build ||
    replay.protocol !== identity.protocol ||
    replay.durationMilliseconds !== identity.durationMilliseconds ||
    replay.roster.length !== identity.participantCount
  )
    throw new Error("Replay motion identity differs from the scene.");
  const options = { allowCurrentBuild: allowCurrentBuild === true };
  if (inhibitorCatalog !== undefined && !options.allowCurrentBuild)
    throw Error(
      "Replay-derived inhibitors require the reviewed current build.",
    );
  if (turretCatalog !== undefined && !options.allowCurrentBuild)
    throw Error("Replay-derived turrets require the reviewed current build.");
  if (nexusCatalog !== undefined && !options.allowCurrentBuild)
    throw Error(
      "Replay-derived Nexus models require the reviewed current build.",
    );
  if (
    championModelCatalog !== undefined &&
    (!options.allowCurrentBuild || replay.build !== currentTerrainPositionBuild)
  )
    throw Error(
      "Replay-derived champion models require the reviewed current build.",
    );
  if (
    decodePlayerState !== undefined &&
    (decodePlayerState !== true ||
      !options.allowCurrentBuild ||
      replay.build !== currentTerrainPositionBuild)
  )
    throw Error(
      "Replay-derived player state requires the reviewed current build.",
    );
  if (
    decodeNeutralCamps !== undefined &&
    (decodeNeutralCamps !== true || neutralObjectiveModels === undefined)
  )
    throw Error(
      "Replay-derived camps require authored neutral model bindings.",
    );
  if ((decodeNeutralCamps === true) !== (neutralCampSkins !== undefined))
    throw Error(
      "Replay-derived camps require verified requested skin bindings.",
    );
  if (
    neutralObjectiveModels !== undefined &&
    (!options.allowCurrentBuild || replay.build !== currentTerrainPositionBuild)
  )
    throw Error(
      "Replay-derived neutral objectives require the reviewed current build.",
    );
  const neutralModelIds =
    neutralObjectiveModels === undefined
      ? undefined
      : readCurrentNeutralObjectiveModelIds(
          neutralObjectiveModels,
          decodeNeutralCamps,
        );
  const campSkins =
    decodeNeutralCamps === true
      ? readCurrentNeutralCampSkins(neutralCampSkins, neutralModelIds)
      : undefined;
  if (
    laneMinionCatalog !== undefined &&
    (laneMinionCatalog === null ||
      !options.allowCurrentBuild ||
      replay.build !== currentTerrainPositionBuild ||
      !Array.isArray(waypointOrigin) ||
      waypointOrigin.length !== 2 ||
      waypointOrigin[0] !== 7358 ||
      waypointOrigin[1] !== 7412)
  )
    throw Error(
      "Replay-derived lane minions require the reviewed current build.",
    );
  const laneModelIds =
    laneMinionCatalog === undefined
      ? undefined
      : await readLaneModelIds(laneMinionCatalog);
  if (
    decodeTeamVision === true
      ? !options.allowCurrentBuild ||
        replay.build !== currentTerrainPositionBuild ||
        !Array.isArray(teamVisionWorldActors)
      : decodeTeamVision !== undefined || teamVisionWorldActors !== undefined
  )
    throw Error(
      "Replay-derived team vision requires the reviewed current build and actor bindings.",
    );
  if (
    decodeChampionStats !== undefined &&
    (decodeChampionStats !== true ||
      !options.allowCurrentBuild ||
      replay.build !== currentTerrainPositionBuild)
  )
    throw new Error(
      "Replay-derived champion stats require the reviewed current build.",
    );
  if (
    decodeChampionInventory !== undefined &&
    (decodeChampionInventory !== true ||
      !options.allowCurrentBuild ||
      replay.build !== currentTerrainPositionBuild)
  )
    throw new Error(
      "Replay-derived champion inventory requires the reviewed current build.",
    );
  if (
    decodeChampionExperience !== undefined &&
    (decodeChampionExperience !== true ||
      !options.allowCurrentBuild ||
      replay.build !== currentTerrainPositionBuild)
  )
    throw Error(
      "Replay-derived champion experience requires the reviewed current build.",
    );
  if (
    (championAnimationCatalog !== undefined ||
      championAnimationModelCatalog !== undefined) &&
    (!options.allowCurrentBuild || replay.build !== currentTerrainPositionBuild)
  )
    throw Error(
      "Replay-derived champion animations require the reviewed current build.",
    );
  if (
    championAnimationModelCatalog !== undefined &&
    (championAnimationCatalog !== undefined ||
      championModelCatalog === undefined)
  )
    throw Error(
      "Build-scoped champion animations require only the archive model catalog.",
    );
  if (
    announcerEvents !== undefined &&
    (!options.allowCurrentBuild || replay.build !== currentTerrainPositionBuild)
  )
    throw Error(
      "Replay-derived announcer cues require the reviewed current build.",
    );
  if (terrainControllerGraph !== undefined) {
    if (
      !options.allowCurrentBuild ||
      replay.build !== currentTerrainPositionBuild
    )
      throw Error(
        "Replay-derived terrain visibility requires the reviewed current build.",
      );
    await verifyCurrentMap11ControllerGraph(terrainControllerGraph);
  }
  const announcerMapping =
    announcerEvents === undefined
      ? undefined
      : readAnnouncerEventMapping(announcerEvents);
  const codecs = await createPreparedTerrainByteCodecs(
    new Uint8Array(decoderBytes),
    replay,
    options,
  );
  const replayPreparation = prepareReplayForSeek(
    replayBytes,
    decompress,
    options,
  );
  const { binding, openingCreations } = bindNativeTerrainChampionIdentities(
    replayPreparation,
    codecs,
    { ...options, includeSkin: championModelCatalog !== undefined },
  );
  const prepared = {
    ...replayPreparation,
    observations: { ...replayPreparation.observations, binding },
  };
  const recordedPlayerState =
    decodePlayerState === true
      ? readCurrentRecordedPlayerState(
          replay,
          replayPreparation.observations,
          binding,
        )
      : undefined;
  const championModels =
    championModelCatalog === undefined
      ? undefined
      : prepareCurrentChampionModelBindings(
          championModelCatalog,
          prepared.observations,
          openingCreations,
        );
  const keyframes = prepareNativeTerrainChampionKeyframes(
    prepared,
    createPosition944ReaderFromCodecs(codecs),
    options,
  );
  const inventory =
    decodeChampionInventory === true
      ? createRecordedInventoryCollector(replay, identity, prepared, codecs)
      : undefined;
  const selectedAnimations =
    championAnimationModelCatalog === undefined
      ? undefined
      : selectChampionAnimations(
          replay,
          championAnimationModelCatalog,
          championModels,
        );
  const animationActors =
    championAnimationCatalog === undefined
      ? selectedAnimations?.actors
      : readPreparedChampionAnimationActors(binding, championAnimationCatalog);
  const animation =
    animationActors === undefined
      ? undefined
      : createChampionAnimationCollector(replay, codecs, animationActors);
  const announcer =
    announcerMapping === undefined
      ? undefined
      : createCurrentMap11AnnouncerCollector(
          replay,
          recoverTerrainByteSubstitution(codecs),
          announcerMapping,
        );
  const inhibitors =
    inhibitorCatalog === undefined
      ? undefined
      : createCurrentReplayInhibitorCollector(prepared, inhibitorCatalog);
  const turrets =
    turretCatalog === undefined
      ? undefined
      : createCurrentReplayTurretCollector(prepared, turretCatalog);
  const nexus =
    nexusCatalog === undefined
      ? undefined
      : createCurrentReplayNexusCollector(
          prepared,
          nexusCatalog,
          codecs,
          turrets?.opening,
        );
  const dynamicActors =
    laneMinionCatalog !== undefined ||
    neutralModelIds !== undefined ||
    inhibitors !== undefined ||
    turrets !== undefined ||
    nexus !== undefined;
  const teamVision =
    decodeTeamVision === true
      ? createCurrentRecordedTeamVisionCollector(
          replay,
          binding.verified.map(({ context, footerRow }) => ({
            participantId: context,
            teamId: prepared.observations.roster[footerRow - 1]?.team,
          })),
          teamVisionWorldActors,
          codecs,
          { dynamicActors },
        )
      : undefined;
  if (teamVision !== undefined)
    for (const { context } of inhibitors?.instances ?? [])
      teamVision.addCandidate(context, 0);
  if (teamVision !== undefined)
    for (const context of turrets?.candidateContexts ?? [])
      teamVision.addCandidate(context, 0);
  if (teamVision !== undefined)
    for (const { context } of nexus?.instances ?? [])
      teamVision.addCandidate(context, 0);
  const rawWaypoints = createWaypointReaderFromCodecs(codecs);
  const readWaypoints = dynamicActors
    ? cacheLastWaypoints(rawWaypoints)
    : rawWaypoints;
  const lane =
    laneMinionCatalog === undefined
      ? undefined
      : createCurrentLaneMinionCollector({
          replay,
          codecs,
          movementOrigin: waypointOrigin,
          barracksPlacements: laneMinionCatalog.barracksPlacements,
          onBirth: teamVision?.addCandidate,
          readWaypoints,
        });
  const neutral =
    neutralModelIds === undefined
      ? undefined
      : createCurrentNeutralObjectiveCollector({
          replay,
          binding,
          codecs,
          readWaypoints,
          onBirth: teamVision?.addCandidate,
          includeCamps: decodeNeutralCamps,
          includeKeyframeAnchors: decodeNeutralCamps,
          onCampBirth: teamVision?.addCandidate,
        });
  const terrain =
    terrainControllerGraph === undefined
      ? undefined
      : createCurrentMap11ControllerObserver({
          ...terrainControllerGraph,
          identity: {
            replaySha256: identity.replaySha256,
            build: replay.build,
            protocol: replay.protocol,
            geometrySha256: terrainControllerGraph.geometrySha256,
            materialsSha256: terrainControllerGraph.materialsSha256,
          },
          codecs,
          durationSeconds: replay.duration,
        });
  const observers = [
    inventory,
    animation,
    announcer,
    teamVision,
    terrain,
    lane,
    neutral,
    inhibitors,
    turrets,
    nexus,
  ].filter((collector) => collector !== undefined);
  const observe = (packet) => {
    for (const observer of observers) observer.observe(packet);
  };
  const packets = replayTimedPacketEnvelopes(
    replayPacketEnvelopes(replay, decompress),
  );
  const { motion, coverage, championStats, championExperienceTracks } =
    prepareNativeTerrainMotion(
      prepared,
      keyframes,
      observers.length === 0 ? packets : observeMotionPackets(packets, observe),
      {
        readWaypoints,
        readMoveSpeed: createMoveSpeed309ReaderFromCodecs(codecs),
        waypointOrigin,
        ...(decodeChampionStats === true ? { includeChampionStats: true } : {}),
        ...(decodeChampionExperience === true
          ? { includeChampionExperience: true }
          : {}),
        ...options,
      },
    );
  if (decodeChampionStats === true && championStats === undefined)
    throw new Error(
      "Replay motion worker has no champion stats for this replay.",
    );
  if (observers.length > 0) {
    for (const packet of packets) observe(packet);
  }
  if (championExperienceTracks !== undefined)
    verifyRecordedChampionExperienceFooter(
      replay.bytes,
      binding,
      championExperienceTracks,
    );
  let terrainVisibility;
  if (terrain !== undefined) {
    const observed = terrain.finish();
    const missing = terrainControllerGraph.missingReplacementMeshControllerIds;
    terrainVisibility = {
      tracks: observed.tracks.filter(
        ({ controllerId }) => !missing.includes(controllerId),
      ),
      unresolvedMeshControllerIds: observed.unresolvedMeshControllerIds,
      missingReplacementMeshControllerIds: missing,
      omittedMeshControllerIds: observed.unresolvedMeshControllerIds,
      ...(observed.unresolvedWindows === undefined
        ? {}
        : {
            unresolvedWindows: observed.unresolvedWindows.filter(
              ({ controllerId }) => !missing.includes(controllerId),
            ),
          }),
    };
  }
  const laneResult =
    lane === undefined ? undefined : finishLaneMinions(lane, laneModelIds);
  const neutralResult =
    neutral === undefined
      ? undefined
      : prepareCurrentNeutralObjectiveScene({
          evidence: neutral.finish(),
          modelIds: neutralModelIds,
          waypointOrigin,
          durationSeconds: replay.duration,
          includeCamps: decodeNeutralCamps,
          campSkins,
        });
  const turretResult = turrets?.finish();
  const nexusResult = await nexus?.finish();
  const visibleDynamicContexts = dynamicActors
    ? new Set([
        ...(laneResult?.laneMinionInstances ?? []).map(
          ({ context }) => context,
        ),
        ...(neutralResult?.neutralObjectiveInstances ?? []).map(
          ({ context }) => context,
        ),
        ...(inhibitors?.instances ?? []).map(({ context }) => context),
        ...(turretResult?.structureModels.instances ?? []).map(
          ({ context }) => context,
        ),
        ...(nexusResult?.nexusModels.instances ?? []).map(
          ({ context }) => context,
        ),
      ])
    : undefined;
  return {
    type: "ready",
    frames: keyframes.frames,
    motion,
    coverage,
    ...(championStats === undefined ? {} : { championStats }),
    ...(recordedPlayerState === undefined ? {} : { recordedPlayerState }),
    ...(championModels === undefined ? {} : { championModels }),
    ...(inventory === undefined
      ? {}
      : { championInventoryTracks: inventory.finish() }),
    ...(championExperienceTracks === undefined
      ? {}
      : { championExperienceTracks }),
    ...(animation === undefined
      ? {}
      : { championAnimationCues: animation.finish() }),
    ...(selectedAnimations === undefined
      ? {}
      : { championAnimationOmissions: selectedAnimations.omissions }),
    ...(laneResult ?? {}),
    ...(neutralResult ?? {}),
    ...(inhibitors?.finish() ?? {}),
    ...(turretResult ?? {}),
    ...(nexusResult ?? {}),
    ...(teamVision === undefined
      ? {}
      : { teamVision: teamVision.finish(visibleDynamicContexts) }),
    ...(terrainVisibility === undefined ? {} : { terrainVisibility }),
    ...(announcer === undefined
      ? {}
      : {
          announcerCues: announcer
            .finish()
            .cues.map(({ timeSeconds, mediaId }) => ({
              timeSeconds,
              mediaId,
            })),
        }),
  };
}

globalThis.addEventListener("message", async ({ data }) => {
  try {
    globalThis.postMessage(await prepareMotion(data));
  } catch (cause) {
    globalThis.postMessage({
      type: "error",
      message:
        cause instanceof Error ? cause.message : "Replay decoding failed.",
    });
  }
});
