import { createHash } from "node:crypto";
import { zstdDecompressSync } from "node:zlib";
import {
  openReplay,
  replayPacketEnvelopes,
} from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/transport.mjs";
import { replayTimedPacketEnvelopes } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/replay-packet-clock.mjs";

// Keep the original replay and extracted packet bodies in the local authoring process.
const [path] = process.argv.slice(2);
if (!path || process.argv.length !== 3)
  throw Error(
    "Usage: bun prepare-recorded-particle-packets.mjs <local replay.rofl>",
  );
const bytes = await Bun.file(path).arrayBuffer();
const sha256 = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
const replay = openReplay(bytes);
if (replay.build !== "16.23.841.8428" || replay.protocol !== "8bbfcd5af2bc92db")
  throw Error("Recorded particle packet build or protocol differs");
const decompress = (input, output) =>
  zstdDecompressSync(input, { maxOutputLength: output.length });
const packets = [];
let opcode = null;
let context = 0;
let sequence = 0;
for (const envelope of replayTimedPacketEnvelopes(
  replayPacketEnvelopes(replay, decompress),
)) {
  if (envelope.blockOffset === 0) {
    opcode = null;
    context = 0;
  }
  opcode = envelope.explicitOpcode ?? opcode;
  context =
    envelope.marker & 32
      ? (context + ((envelope.paramBits << 24) >> 24)) >>> 0
      : envelope.paramBits;
  if (opcode === 938 && envelope.stream === 1)
    packets.push([
      envelope.timeSeconds,
      sequence,
      context,
      Buffer.from(envelope.payload).toString("hex"),
    ]);
  sequence++;
}
console.log(
  JSON.stringify({
    build: replay.build,
    protocol: replay.protocol,
    replaySha256: sha256,
    packets,
  }),
);
