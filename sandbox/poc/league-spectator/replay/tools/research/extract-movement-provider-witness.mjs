import assert from "node:assert/strict";
import { zstdDecompressSync } from "node:zlib";
import { prepareReplayForSeek } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/prepare.mjs";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";
import {
  readChampionModelSelections,
  verifyNativeCatalogOpening,
} from "./native-terrain-champion-model-catalog.mjs";
import { createExactTerrainByteCodecs } from "./native-terrain-positions-944.mjs";
import { createWaypointReaderFromCodecs } from "./native-terrain-waypoints-reader.mjs";

const [replayPath, archivePath, manifestPath] = process.argv.slice(2);
if (!manifestPath || process.argv.length !== 5)
  throw new Error(
    "Usage: bun extract-movement-provider-witness.mjs <original ROFL> <exact archive> <champion source manifest>",
  );

const sha = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const [replayBytes, archive, manifestBytes] = await Promise.all([
  Bun.file(replayPath).arrayBuffer(),
  Bun.file(archivePath).bytes(),
  Bun.file(manifestPath).bytes(),
]);
const replaySha256 = sha(replayBytes);
const archiveSha256 = sha(archive);
const manifestSha256 = sha(manifestBytes);
assert.equal(
  replaySha256,
  "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1",
);
assert.equal(
  archiveSha256,
  "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7",
);
assert.equal(
  manifestSha256,
  "f193172e6425fe9a858aebadaeb0d5baf5c91372c1332d5093462199ddad2145",
);

const replay = openReplay(replayBytes);
const options = { allowCurrentBuild: true };
const inflate = (bytes, output) =>
  zstdDecompressSync(bytes, { maxOutputLength: output.length });
const codecs = createExactTerrainByteCodecs(archive, replay, options);
const preparation = prepareReplayForSeek(replayBytes, inflate, options);
const roster = readChampionModelSelections(preparation, codecs, options);
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
verifyNativeCatalogOpening(manifest.nativeOpening, roster, replaySha256);
const actor = roster.find(({ champion }) => champion === "Maokai");
assert.equal(actor?.skinId, 33);
const read = createWaypointReaderFromCodecs(codecs);
const rows = [];
let opcode;
for (const packet of replayTimedPacketEnvelopes(
  replayPacketEnvelopes(replay, inflate),
)) {
  if (packet.blockOffset === 0) opcode = undefined;
  opcode = packet.explicitOpcode ?? opcode;
  if (
    packet.chunkId !== 60 ||
    packet.stream !== 1 ||
    opcode !== 96 ||
    packet.blockOffset < 41442 ||
    packet.blockOffset > 42330
  )
    continue;
  const { records, syncId } = read(opcode, packet.payload);
  const matching = records.filter(({ entityId }) => entityId === actor.context);
  assert.ok(matching.length <= 1);
  for (const { encodedWaypoints } of matching) {
    const { blockOffset, timeSeconds } = packet;
    rows.push({
      opcode,
      chunkId: packet.chunkId,
      blockOffset,
      timeSeconds,
      packetSha256: sha(packet.payload),
      syncId,
      encodedWaypoints,
    });
  }
}
assert.deepEqual(
  rows.map(({ blockOffset }) => blockOffset),
  [41442, 42330],
);
assert.deepEqual(
  rows.map(({ encodedWaypoints }) => encodedWaypoints.length),
  [3, 1],
);
console.log(
  JSON.stringify({
    schema: 1,
    build: replay.build,
    protocol: replay.protocol,
    replaySha256,
    archiveSha256,
    manifestSha256,
    actor,
    rows,
  }),
);
