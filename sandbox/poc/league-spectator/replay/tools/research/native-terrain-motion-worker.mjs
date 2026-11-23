import { decompress } from "scout-terrain-fzstd";
import { prepareReplayForSeek } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/prepare.mjs";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";
import { createPreparedTerrainByteCodecs } from "./native-terrain-byte-codecs.mjs";
import { bindNativeTerrainChampionIdentities } from "./native-terrain-champion-identities.mjs";
import { prepareNativeTerrainChampionKeyframes } from "./native-terrain-champion-keyframes.mjs";
import { prepareNativeTerrainMotion } from "./native-terrain-motion.mjs";
import { createMoveSpeed309ReaderFromCodecs } from "./native-terrain-move-speed-reader.mjs";
import { createPosition944ReaderFromCodecs } from "./native-terrain-positions-944-reader.mjs";
import { createWaypointReaderFromCodecs } from "./native-terrain-waypoints-reader.mjs";

async function prepareMotion({
  identity,
  waypointOrigin,
  replayBytes,
  decoderBytes,
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
  const codecs = await createPreparedTerrainByteCodecs(
    new Uint8Array(decoderBytes),
    replay,
  );
  const replayPreparation = prepareReplayForSeek(replayBytes, decompress);
  const { binding } = bindNativeTerrainChampionIdentities(
    replayPreparation,
    codecs,
  );
  const prepared = {
    ...replayPreparation,
    observations: { ...replayPreparation.observations, binding },
  };
  const keyframes = prepareNativeTerrainChampionKeyframes(
    prepared,
    createPosition944ReaderFromCodecs(codecs),
  );
  const { motion, coverage } = prepareNativeTerrainMotion(
    prepared,
    keyframes,
    replayTimedPacketEnvelopes(replayPacketEnvelopes(replay, decompress)),
    {
      readWaypoints: createWaypointReaderFromCodecs(codecs),
      readMoveSpeed: createMoveSpeed309ReaderFromCodecs(codecs),
      waypointOrigin,
    },
  );
  return { type: "ready", frames: keyframes.frames, motion, coverage };
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
