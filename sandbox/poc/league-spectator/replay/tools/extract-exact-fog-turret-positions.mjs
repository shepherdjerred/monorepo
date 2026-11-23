import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import {
  openReplay,
  replayPacketEnvelopes,
} from "../../../../../packages/scout-for-lol/packages/replay/src/observations/transport.mjs";

const [replayPath, censusPath, output] = process.argv.slice(2);
if (process.argv.length !== 5)
  throw Error(
    "Usage: bun extract-exact-fog-turret-positions.mjs <saved-rofl> <exact-owner-census> <new-output.json>",
  );
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const censusBytes = readFileSync(censusPath);
const censusSha256 = sha(censusBytes);
assert.equal(
  censusSha256,
  "b1f38dc0f852055d5a2d38aa34afca08a7dacd207b07a082601588fe7a3b41bc",
);
const census = JSON.parse(censusBytes);
const replayBytes = readFileSync(replayPath);
assert.equal(sha(replayBytes), census.replaySha256);
const replay = openReplay(Uint8Array.from(replayBytes).buffer);
assert.equal(replay.build, census.build);
assert.equal(replay.protocol, census.protocol);
const expected = new Map();
for (const row of census.rows.filter(({ worldBinding }) => worldBinding)) {
  for (const position of [row.openingPosition, row.keyframePosition]) {
    const id = `${position.chunk}/${position.offset}`;
    assert.ok(!expected.has(id));
    expected.set(id, {
      ...position,
      ownerId: row.ownerId,
      providerId: row.providerId,
      authoredXYZ: row.worldBinding.authoredPositionXYZ,
    });
  }
}
assert.equal(expected.size, 22);
const rows = [];
let opcode = null;
let context = 0;
for (const packet of replayPacketEnvelopes(replay, (input, target) =>
  zstdDecompressSync(input, { maxOutputLength: target.byteLength }),
)) {
  if (packet.blockOffset === 0) {
    opcode = null;
    context = 0;
  }
  opcode = packet.explicitOpcode ?? opcode;
  context =
    packet.marker & 32
      ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
      : packet.paramBits;
  if (packet.stream !== 2 || opcode !== 944) continue;
  const id = `${packet.chunkId}/${packet.blockOffset}`;
  const row = expected.get(id);
  if (!row) continue;
  assert.equal(context, row.ownerId);
  assert.equal(sha(packet.payload), row.sha256);
  rows.push({
    ...row,
    payloadHex: Buffer.from(packet.payload).toString("hex"),
  });
  expected.delete(id);
}
assert.equal(expected.size, 0);
const { build, protocol, replaySha256 } = census;
writeFileSync(
  output,
  JSON.stringify(
    { build, protocol, replaySha256, censusSha256, rows },
    null,
    2,
  ) + "\n",
  {
    flag: "wx",
  },
);
