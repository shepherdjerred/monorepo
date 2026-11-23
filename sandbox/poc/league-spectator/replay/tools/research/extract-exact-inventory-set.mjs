import { writeFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";

const [replayPath, goldPath, outputPath, mode] = process.argv.slice(2);
if (!replayPath || !goldPath || !outputPath)
  throw Error(
    "Usage: bun extract-exact-inventory-set.mjs REPLAY GOLD_TRACKS OUTPUT",
  );
const sha256 = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
if (mode !== undefined && mode !== "--all")
  throw Error("Unknown inventory extraction mode");
const channels = new Set([190, 226, 248, 415, 797, 840, 1143, 1214]);
const goldDigests = new Map([
  [
    "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668",
    "df874b09c242ab8b22b111d9516b482a309bb1bd0c25784daef660ef0ce44273",
  ],
  [
    "d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b",
    "cf3b56a8b3908dc5bf1f15395f1140d57ea10412b1a1940942944f1301b239e6",
  ],
]);
const bytes = await Bun.file(replayPath).arrayBuffer();
const replay = openReplay(bytes);
const replaySha256 = sha256(bytes);
const goldBytes = await Bun.file(goldPath).arrayBuffer();
const goldSha256 = sha256(goldBytes);
if (
  replay.build !== "16.23.840.6595" ||
  replay.protocol !== "8bbfcd5af2bc92db" ||
  goldDigests.get(replaySha256) !== goldSha256
)
  throw Error("Expected a pinned exact replay and its recorded gold tracks");
const { tracks } = JSON.parse(new TextDecoder().decode(goldBytes));
const participants = new Set(tracks.map(({ participantId }) => participantId));
const spends = [];
for (const { participantId, gold } of tracks) {
  for (let i = 1; i < gold.length; i++) {
    const [timeSeconds, after] = gold[i];
    const before = gold[i - 1][1];
    if (after < before)
      spends.push({ participantId, timeSeconds, before, after });
  }
}

const decompress = (input, output) =>
  zstdDecompressSync(input, { maxOutputLength: output.length });
let opcode, context;
const rows = [];
const streamCounts = {};
const rosterOpcodesByStream = {};
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
  if (participants.has(context)) {
    const stream = (rosterOpcodesByStream[packet.stream] ??= {});
    stream[opcode] = (stream[opcode] ?? 0) + 1;
  }
  if (mode === "--all" ? !channels.has(opcode) : opcode !== 840) continue;
  streamCounts[packet.stream] = (streamCounts[packet.stream] ?? 0) + 1;
  rows.push({
    context,
    stream: packet.stream,
    timeSeconds: packet.timeSeconds,
    chunkOffset: packet.chunkOffset,
    blockOffset: packet.blockOffset,
    body: Buffer.from(packet.payload).toString("hex"),
    ...(mode === "--all"
      ? { opcode, secondTimeBits: packet.secondTimeBits }
      : {}),
  });
}
await writeFile(
  outputPath,
  JSON.stringify({
    build: replay.build,
    protocol: replay.protocol,
    replaySha256,
    goldSha256,
    participants: [...participants],
    spends,
    streamCounts,
    rosterOpcodesByStream,
    rows,
  }) + "\n",
  { flag: "wx" },
);
