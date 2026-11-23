import { readFileSync, writeFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";

const [replayFile, output] = process.argv.slice(2);
if (!replayFile || !output || process.argv.length !== 4)
  throw Error(
    "Usage: bun extract-exact-announcement-packets.mjs REPLAY OUTPUT",
  );
const bytes = readFileSync(replayFile);
const replay = openReplay(Uint8Array.from(bytes).buffer);
if (replay.build !== "16.23.840.6595" || replay.protocol !== "8bbfcd5af2bc92db")
  throw Error("Expected the reviewed announcement build and protocol");
const decompress = (body, target) =>
  zstdDecompressSync(body, { maxOutputLength: target.byteLength });
const rows = [];
const countsByStream = { 1: 0, 2: 0, 3: 0, 4: 0 };
let opcode;
let context;
for (const packet of replayTimedPacketEnvelopes(
  replayPacketEnvelopes(replay, decompress),
)) {
  if (packet.blockOffset === 0) {
    opcode = undefined;
    context = 0;
  }
  opcode = packet.explicitOpcode ?? opcode;
  context =
    packet.marker & 32
      ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
      : packet.paramBits;
  if (opcode !== 880) continue;
  if (!(packet.stream in countsByStream))
    throw Error("Unexpected saved announcement stream");
  countsByStream[packet.stream]++;
  rows.push({
    opcode,
    stream: packet.stream,
    chunkOffset: packet.chunkOffset,
    blockOffset: packet.blockOffset,
    context,
    timeSeconds: packet.timeSeconds,
    body: Buffer.from(packet.payload).toString("hex"),
  });
}
writeFileSync(
  output,
  JSON.stringify({
    identity: {
      build: replay.build,
      protocol: replay.protocol,
      replaySha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    },
    countsByStream,
    rows,
  }) + "\n",
  { flag: "wx" },
);
