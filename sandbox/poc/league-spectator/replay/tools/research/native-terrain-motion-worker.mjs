import { decompress } from "scout-terrain-fzstd";
import { prepareReplayForSeek } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/prepare.mjs";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";
import {
  createPreparedTerrainByteCodecs,
  currentTerrainPositionBuild,
} from "./native-terrain-byte-codecs.mjs";
import { bindNativeTerrainChampionIdentities } from "./native-terrain-champion-identities.mjs";
import { prepareNativeTerrainChampionKeyframes } from "./native-terrain-champion-keyframes.mjs";
import { prepareNativeTerrainMotion } from "./native-terrain-motion.mjs";
import { createMoveSpeed309ReaderFromCodecs } from "./native-terrain-move-speed-reader.mjs";
import { createPosition944ReaderFromCodecs } from "./native-terrain-positions-944-reader.mjs";
import { createWaypointReaderFromCodecs } from "./native-terrain-waypoints-reader.mjs";
import { createRecordedInventoryCollector } from "./recorded-inventory-packets.mjs";

function* observeMotionPackets(packets, observe) {
  // Motion may stop after the game clock. Keep ownership of the underlying
  // iterator so inventory can still validate the remaining physical packets.
  for (let next = packets.next(); !next.done; next = packets.next()) {
    observe(next.value);
    yield next.value;
  }
}

async function prepareMotion({
  identity,
  waypointOrigin,
  replayBytes,
  decoderBytes,
  allowCurrentBuild = false,
  decodeChampionStats,
  decodeChampionInventory,
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
  const packets = replayTimedPacketEnvelopes(
    replayPacketEnvelopes(replay, decompress),
  );
  const { motion, coverage, championStats } = prepareNativeTerrainMotion(
    prepared,
    keyframes,
    inventory === undefined
      ? packets
      : observeMotionPackets(packets, inventory.observe),
    {
      readWaypoints: createWaypointReaderFromCodecs(codecs),
      readMoveSpeed: createMoveSpeed309ReaderFromCodecs(codecs),
      waypointOrigin,
      ...(decodeChampionStats === true ? { includeChampionStats: true } : {}),
      ...options,
    },
  );
  if (decodeChampionStats === true && championStats === undefined)
    throw new Error(
      "Replay motion worker has no champion stats for this replay.",
    );
  if (inventory !== undefined) {
    for (const packet of packets) inventory.observe(packet);
  }
  return {
    type: "ready",
    frames: keyframes.frames,
    motion,
    coverage,
    ...(championStats === undefined ? {} : { championStats }),
    ...(inventory === undefined
      ? {}
      : { championInventoryTracks: inventory.finish() }),
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
