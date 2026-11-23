import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { replayTimedPacketEnvelopes } from "../../../../../packages/scout-for-lol/packages/replay/src/observations/replay-packet-clock.mjs";
import {
  openReplay,
  replayPacketEnvelopes,
} from "../../../../../packages/scout-for-lol/packages/replay/src/observations/transport.mjs";

const [shortReplay, longReplay, output] = process.argv.slice(2);
if (process.argv.length !== 5)
  throw Error(
    "Usage: bun extract-exact-fog-provider-packets.mjs <short.rofl> <long.rofl> <output.json>",
  );

const build = "16.23.840.6595";
const protocol = "8bbfcd5af2bc92db";
const inputs = [
  [
    shortReplay,
    "d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b",
    [136, 84, 11, 0],
  ],
  [
    longReplay,
    "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668",
    [10688, 2788, 1129, 0],
  ],
];

const rows = [];
const fixtures = [];
for (const [path, expectedHash, expectedCounts] of inputs) {
  const filename = /^NA1-(\d+)\.rofl$/iu.exec(basename(path));
  const match = Number(filename?.[1]);
  if (!Number.isSafeInteger(match) || match <= 0)
    throw Error("Expected the original NA1 replay filename");
  const bytes = readFileSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expectedHash)
    throw Error(`Saved replay digest mismatch for ${match}`);
  const replay = openReplay(Uint8Array.from(bytes).buffer);
  if (replay.build !== build || replay.protocol !== protocol)
    throw Error(`Saved replay build or protocol mismatch for ${match}`);
  fixtures.push({ match, sha256 });

  const counts = [0, 0, 0, 0];
  let opcode = null;
  let context = 0;
  const packets = replayPacketEnvelopes(replay, (compressed, out) =>
    zstdDecompressSync(compressed, { maxOutputLength: out.length }),
  );
  for (const packet of replayTimedPacketEnvelopes(packets)) {
    if (packet.blockOffset === 0) {
      opcode = null;
      context = 0;
    }
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    if (opcode === 985)
      throw Error("Unexpected recorded provider position update in pinned fixture");
    if (opcode !== 1158 && opcode !== 820) continue;
    if (packet.stream !== 1 && packet.stream !== 2)
      throw Error(`Unexpected provider packet stream ${packet.stream}`);
    counts[(opcode === 1158 ? 0 : 2) + packet.stream - 1]++;
    rows.push({
      match,
      stream: packet.stream,
      chunk: packet.chunkId,
      timeSeconds: packet.timeSeconds,
      offset: packet.blockOffset,
      opcode,
      context,
      payload: Buffer.from(packet.payload).toString("hex"),
    });
  }
  if (counts.some((count, index) => count !== expectedCounts[index]))
    throw Error(`Unexpected provider packet census for ${match}: ${counts}`);
}

const evidence = JSON.stringify({ build, protocol, fixtures, rows }) + "\n";
writeFileSync(output, evidence, { flag: "wx" });
console.log(createHash("sha256").update(evidence).digest("hex"));
