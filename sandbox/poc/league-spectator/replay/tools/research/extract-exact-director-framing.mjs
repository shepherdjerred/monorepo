import { writeFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
import { prepareReplayForSeek } from "../../../../../../packages/scout-for-lol/packages/replay/src/prepare.ts";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";
import { prepareNativeTerrainChampionKeyframes } from "./native-terrain-champion-keyframes.mjs";
import { prepareNativeTerrainMotion } from "./native-terrain-motion.mjs";
import { createMoveSpeed309Reader } from "./native-terrain-move-speed.mjs";
import { createPosition944Reader } from "./native-terrain-positions-944.mjs";
import { createWaypointReader } from "./native-terrain-waypoints.mjs";

const [replayFile, clientFile, output] = process.argv.slice(2);
if (!replayFile || !clientFile || !output)
  throw Error(
    "Usage: bun extract-exact-director-framing.mjs ROFL MACH_O OUTPUT",
  );
const [rawReplay, client] = await Promise.all([
  Bun.file(replayFile).arrayBuffer(),
  Bun.file(clientFile).bytes(),
]);
const sha = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const replay = openReplay(rawReplay);
const identity = {
  replaySha256: sha(rawReplay),
  build: replay.build,
  protocol: replay.protocol,
  durationMilliseconds: replay.durationMilliseconds,
  participantCount: replay.roster.length,
};
if (
  identity.replaySha256 !==
    "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668" ||
  identity.build !== "16.23.840.6595" ||
  identity.protocol !== "8bbfcd5af2bc92db" ||
  identity.participantCount !== 10 ||
  sha(client) !==
    "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15"
)
  throw Error("Expected the exact saved long replay and archived client");
const decompress = (input, target) =>
  zstdDecompressSync(input, { maxOutputLength: target.byteLength });
const prepared = prepareReplayForSeek(rawReplay, decompress);
const keyframes = prepareNativeTerrainChampionKeyframes(
  prepared,
  createPosition944Reader(client, identity),
);
const { sample } = prepareNativeTerrainMotion(
  prepared,
  keyframes,
  replayTimedPacketEnvelopes(replayPacketEnvelopes(replay, decompress)),
  {
    readWaypoints: createWaypointReader(client, identity),
    readMoveSpeed: createMoveSpeed309Reader(client, identity),
    // Map11 navgrid origin already verified by the exact motion producer.
    waypointOrigin: [7358, 7412],
  },
);
const roster = new Map(
  prepared.observations.binding.verified.map(({ context, footerRow }) => [
    context,
    replay.roster[footerRow - 1],
  ]),
);
const samples = [0, keyframes.frames[1].timeSeconds, 78.45333099365234].map(
  (timeSeconds) => {
    const { markers } = sample(timeSeconds);
    if (markers.length !== 10)
      throw Error("Expected all ten live champion samples");
    return {
      timeSeconds,
      actors: markers.map(({ participantId, x, z, source }) => ({
        participantId,
        x,
        z,
        source,
        ...roster.get(participantId),
      })),
    };
  },
);
await writeFile(output, JSON.stringify({ identity, samples }) + "\n", {
  flag: "wx",
});
