import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
import { replayTimedPacketEnvelopes } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";

const [replayPath, outputPath] = process.argv.slice(2);
assert(
  replayPath && outputPath,
  "Supply the reviewed replay and a new private JSON output path",
);
const bytes = await Bun.file(replayPath).arrayBuffer();
const replay = openReplay(bytes);
const replaySha256 = Bun.CryptoHasher.hash("sha256", bytes, "hex");
assert.equal(replay.build, "16.23.841.8428");
assert.equal(replay.protocol, "8bbfcd5af2bc92db");
assert.equal(
  replaySha256,
  "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1",
);

const obstacleOpcodes = new Set([41, 493, 1055]);
const keyframeChunks = new Set();
const rows = [];
const decompress = (input, output) =>
  zstdDecompressSync(input, { maxOutputLength: output.length });
let opcode;
let context = 0;
let sequence = 0;
for (const packet of replayTimedPacketEnvelopes(
  replayPacketEnvelopes(replay, decompress),
)) {
  sequence++;
  if (packet.blockOffset === 0) {
    opcode = undefined;
    context = 0;
    if (packet.stream === 2) keyframeChunks.add(packet.chunkId);
  }
  opcode = packet.explicitOpcode ?? opcode;
  context =
    packet.marker & 32
      ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
      : packet.paramBits;
  if (obstacleOpcodes.has(opcode)) {
    rows.push({
      opcode,
      context,
      sequence,
      stream: packet.stream,
      chunk: packet.chunkId,
      offset: packet.blockOffset,
      timeSeconds: packet.timeSeconds,
      body: Buffer.from(packet.payload).toString("hex"),
    });
  }
}

const receipt = {
  schema: 1,
  kind: "exact-rift-obstacle-envelope-census",
  build: replay.build,
  protocol: replay.protocol,
  replaySha256,
  physicalEnvelopesScanned: sequence,
  keyframeChunks: [...keyframeChunks],
  rows,
};
await writeFile(outputPath, JSON.stringify(receipt) + "\n", { flag: "wx" });
console.log(
  `Retained ${rows.length} obstacle envelopes across ${keyframeChunks.size} keyframes.`,
);
