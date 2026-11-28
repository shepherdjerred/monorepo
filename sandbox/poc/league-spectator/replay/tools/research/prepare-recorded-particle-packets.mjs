import { createHash } from "node:crypto";
import { realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import {
  openReplay,
  replayPacketEnvelopes,
} from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/transport.mjs";
import { replayTimedPacketEnvelopes } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/replay-packet-clock.mjs";

// Keep the original replay and extracted packet bodies in the local authoring process.
const [path, flag, opcodeArgument, output, ...extra] = process.argv.slice(2);
const stops =
  flag === "--opcode" && opcodeArgument === "1164" && Boolean(output);
if (!path || extra.length !== 0 || (flag !== undefined && !stops))
  throw Error(
    "Usage: bun prepare-recorded-particle-packets.mjs <local replay.rofl> [--opcode 1164 <fresh .cache JSON>]",
  );
if (stops) {
  const [cache, parent] = await Promise.all([
    realpath(".cache"),
    realpath(dirname(output)),
  ]);
  const privatePath = relative(cache, parent);
  if (isAbsolute(privatePath) || privatePath.split(/[\\/]/u, 1)[0] === "..")
    throw Error("Expected a fresh private .cache output");
}
const bytes = await Bun.file(path).arrayBuffer();
const sha256 = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
const replay = openReplay(bytes);
if (replay.build !== "16.23.841.8428" || replay.protocol !== "8bbfcd5af2bc92db")
  throw Error("Recorded particle packet build or protocol differs");
const decompress = (input, output) =>
  zstdDecompressSync(input, { maxOutputLength: output.length });
const packets = [];
const selectedOpcode = stops ? 1164 : 938;
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
  if (opcode === selectedOpcode && envelope.stream === 1)
    packets.push([
      envelope.timeSeconds,
      sequence,
      context,
      Buffer.from(envelope.payload).toString("hex"),
    ]);
  sequence++;
}
if (stops) {
  const corpus = {
    replaySha256: sha256,
    build: replay.build,
    protocol: replay.protocol,
    opcode: selectedOpcode,
    packets,
  };
  const serialized = JSON.stringify(corpus) + "\n";
  await writeFile(output, serialized, { encoding: "utf8", flag: "wx" });
  console.log(createHash("sha256").update(serialized).digest("hex"));
} else {
  console.log(
    JSON.stringify({
      build: replay.build,
      protocol: replay.protocol,
      replaySha256: sha256,
      packets,
    }),
  );
}
