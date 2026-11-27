import { decompress } from "scout-terrain-fzstd";
import { prepareReplayForSeek } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/prepare.mjs";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";
import { createCurrentChampionAnimationCueAccumulator } from "./native-terrain-animation-cue-reader.mjs";
import { createCurrentMap11AnnouncerCollector } from "./native-terrain-announcer-reader.mjs";
import {
  createPreparedTerrainByteCodecs,
  currentTerrainPositionBuild,
  recoverTerrainByteSubstitution,
} from "./native-terrain-byte-codecs.mjs";
import { bindNativeTerrainChampionIdentities } from "./native-terrain-champion-identities.mjs";
import { prepareNativeTerrainChampionKeyframes } from "./native-terrain-champion-keyframes.mjs";
import { prepareNativeTerrainMotion } from "./native-terrain-motion.mjs";
import { createMoveSpeed309ReaderFromCodecs } from "./native-terrain-move-speed-reader.mjs";
import { createPosition944ReaderFromCodecs } from "./native-terrain-positions-944-reader.mjs";
import { createWaypointReaderFromCodecs } from "./native-terrain-waypoints-reader.mjs";
import { verifyRecordedChampionExperienceFooter } from "./recorded-champion-experience-tracks.mjs";
import { createRecordedInventoryCollector } from "./recorded-inventory-packets.mjs";

function* observeMotionPackets(packets, observe) {
  // Motion may stop after the game clock. Keep ownership of the underlying
  // iterator so the collectors can still read the remaining physical packets.
  for (let next = packets.next(); !next.done; next = packets.next()) {
    observe(next.value);
    yield next.value;
  }
}

function createChampionAnimationCollector(replay, binding, codecs, catalog) {
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
    const byName = new Map();
    const { rig: actorRig, bindings: actorBindings } = actions[0];
    for (const action of actions) {
      const { name, durationSeconds, rig, clip, bindings } = action;
      if (
        typeof name !== "string" ||
        name.length >= 256 ||
        !/^[A-Za-z0-9_]+$/u.test(name) ||
        byName.has(name) ||
        !Number.isFinite(durationSeconds) ||
        durationSeconds <= 0 ||
        typeof rig !== "string" ||
        !/^\/champion-animations\/[a-f0-9]{64}\.skl$/u.test(rig) ||
        rig !== actorRig ||
        typeof clip !== "string" ||
        !/^\/champion-animations\/[a-f0-9]{64}\.clip$/u.test(clip) ||
        typeof bindings !== "string" ||
        !/^\/champion-animations\/[a-f0-9]{64}\.json$/u.test(bindings) ||
        bindings !== actorBindings
      )
        throw Error("Invalid authored champion animation action.");
      byName.set(name, { durationSeconds, rig, clip, bindings });
    }
    actors.set(participantId, { model, actions: byName });
  }
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
  decodeChampionInventory,
  decodeChampionExperience,
  championAnimationCatalog,
  announcerEvents,
}) {
  if (
    !(replayBytes instanceof ArrayBuffer) ||
    !(decoderBytes instanceof ArrayBuffer)
  )
    throw new Error("Replay motion needs replay and decoder bytes.");
  const replayDigest = await crypto.subtle.digest("SHA-256", replayBytes);
  const sha256 = Array.from(new Uint8Array(replayDigest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
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
    championAnimationCatalog !== undefined &&
    (!options.allowCurrentBuild || replay.build !== currentTerrainPositionBuild)
  )
    throw Error(
      "Replay-derived champion animations require the reviewed current build.",
    );
  if (
    announcerEvents !== undefined &&
    (!options.allowCurrentBuild || replay.build !== currentTerrainPositionBuild)
  )
    throw Error(
      "Replay-derived announcer cues require the reviewed current build.",
    );
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
  const { binding } = bindNativeTerrainChampionIdentities(
    replayPreparation,
    codecs,
    options,
  );
  const prepared = {
    ...replayPreparation,
    observations: { ...replayPreparation.observations, binding },
  };
  const keyframes = prepareNativeTerrainChampionKeyframes(
    prepared,
    createPosition944ReaderFromCodecs(codecs),
    options,
  );
  const inventory =
    decodeChampionInventory === true
      ? createRecordedInventoryCollector(replay, identity, prepared, codecs)
      : undefined;
  const animation =
    championAnimationCatalog === undefined
      ? undefined
      : createChampionAnimationCollector(
          replay,
          binding,
          codecs,
          championAnimationCatalog,
        );
  const announcer =
    announcerMapping === undefined
      ? undefined
      : createCurrentMap11AnnouncerCollector(
          replay,
          recoverTerrainByteSubstitution(codecs),
          announcerMapping,
        );
  const observers = [inventory, animation, announcer].filter(
    (collector) => collector !== undefined,
  );
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
        readWaypoints: createWaypointReaderFromCodecs(codecs),
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
  return {
    type: "ready",
    frames: keyframes.frames,
    motion,
    coverage,
    ...(championStats === undefined ? {} : { championStats }),
    ...(inventory === undefined
      ? {}
      : { championInventoryTracks: inventory.finish() }),
    ...(championExperienceTracks === undefined
      ? {}
      : { championExperienceTracks }),
    ...(animation === undefined
      ? {}
      : { championAnimationCues: animation.finish() }),
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
