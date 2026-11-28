import assert from "node:assert/strict";
import { realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";
import { assertRecordedRiftEffectBuild } from "./recorded-rift-effect-packets.mjs";

const [rofl, output, ...extra] = process.argv.slice(2);
assert.ok(
  rofl && output && extra.length === 0,
  "Usage: bun prepare-recorded-rift-missile-corpus.mjs REPLAY_ROFL FRESH_CACHE_JSON",
);
const outputPath = resolve(output);
const cache = await realpath(".cache");
const parent = relative(cache, await realpath(dirname(outputPath)));
assert.ok(
  !isAbsolute(parent) && parent.split(sep)[0] !== "..",
  "Missile corpus must stay inside .cache",
);
const bytes = new Uint8Array(await Bun.file(rofl).arrayBuffer());
const replay = openReplay(bytes.buffer);
assertRecordedRiftEffectBuild(replay);

const creation = [];
const corpus = [];
let sequence = 0;
let opcode;
let context = 0;
for (const envelope of replayTimedPacketEnvelopes(
  replayPacketEnvelopes(replay, Bun.zstdDecompressSync),
)) {
  // The archived projectile oracle uses a 1-based physical packet ordinal
  // including every stream and opcode.
  sequence++;
  if (envelope.blockOffset === 0) {
    opcode = undefined;
    context = 0;
  }
  opcode = envelope.explicitOpcode ?? opcode;
  context =
    envelope.marker & 32
      ? (context + ((envelope.paramBits << 24) >> 24)) >>> 0
      : envelope.paramBits;
  if (envelope.stream !== 1 || opcode !== 639) continue;
  creation.push([context, Buffer.from(envelope.payload).toString("hex")]);
  corpus.push([sequence, envelope.timeSeconds]);
}

await writeFile(
  outputPath,
  JSON.stringify({
    creation,
    components: [],
    controller: [],
    selectMaokaiR: true,
    corpus,
    replaySha256: Bun.CryptoHasher.hash("sha256", bytes, "hex"),
  }),
  { flag: "wx" },
);
console.log(JSON.stringify({ creation: creation.length }));
