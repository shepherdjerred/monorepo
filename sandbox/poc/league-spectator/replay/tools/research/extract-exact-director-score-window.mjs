import { writeFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";

const [replayPath, outputPath, teamInputPath] = process.argv.slice(2);
if (!replayPath || !outputPath)
  throw Error(
    "Usage: bun extract-exact-director-score-window.mjs REPLAY OUTPUT [TEAM_INPUT]",
  );
const bytes = await Bun.file(replayPath).arrayBuffer();
const replay = openReplay(bytes);
const replaySha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
if (
  replay.build !== "16.23.840.6595" ||
  replay.protocol !== "8bbfcd5af2bc92db" ||
  replaySha256 !==
    "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668"
)
  throw Error("Expected the exact saved long replay");

// The time is one second before the verified Renekton elimination. The
// longest compiled leaf lookahead here is FutureDeathInterestTimer (10 s).
const start = 78.45333099365234;
const end = Math.fround(start + 10);
const relevantOpcodes = new Set([530, 557, 880, 1183, 1197]);
const rows = [];
const teamInput = [];
const clock = new DataView(new ArrayBuffer(4));
let nativeTime;
let context;
let opcode;
const decompress = (input, output) =>
  zstdDecompressSync(input, { maxOutputLength: output.length });
for (const packet of replayPacketEnvelopes(replay, decompress)) {
  if (packet.stream !== 1) continue;
  if (packet.blockOffset === 0) {
    opcode = undefined;
    context = 0;
  }
  opcode = packet.explicitOpcode ?? opcode;
  context =
    packet.marker & 32
      ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
      : packet.paramBits;
  if (packet.marker & 128)
    nativeTime = Math.fround(
      nativeTime + Math.fround(packet.firstTimeBits * Math.fround(0.001)),
    );
  else {
    clock.setUint32(0, packet.firstTimeBits, true);
    nativeTime = clock.getFloat32(0, true);
  }
  if (nativeTime < start || nativeTime > end) continue;
  const target = context === 1073743585 && (opcode === 187 || opcode === 1197);
  if (!relevantOpcodes.has(opcode) && !(teamInputPath && target)) continue;
  const row = {
    opcode,
    context,
    time: nativeTime,
    chunkOffset: packet.chunkOffset,
    blockOffset: packet.blockOffset,
    body: Buffer.from(packet.payload).toString("hex"),
  };
  if (teamInputPath && target) teamInput.push(row);
  if (relevantOpcodes.has(opcode)) rows.push(row);
}
await writeFile(
  outputPath,
  JSON.stringify({ replaySha256, start, end, rows }) + "\n",
  { flag: "wx" },
);
if (teamInputPath) {
  if (
    teamInput.length !== 2 ||
    teamInput[0].opcode !== 187 ||
    teamInput[1].opcode !== 1197
  )
    throw Error("Expected the original team-input and terminal packets");
  await writeFile(
    teamInputPath,
    JSON.stringify({ replaySha256, start, rows: teamInput }) + "\n",
    { flag: "wx" },
  );
}
