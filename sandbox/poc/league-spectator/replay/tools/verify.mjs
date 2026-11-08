import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseReplay,
  movementBytes,
  movementPaths,
  FIXTURE_SHA256,
} from "../decoder.mjs";
import { decodeAnimation } from "../animation-decoder.mjs";
import { indexMovement, sampleMovement } from "../playback.mjs";
if (!process.argv[2])
  throw Error(
    "Usage: bun tools/verify.mjs <fixture.rofl> [cache-root] [oracle-dir]",
  );
const cache = resolve(process.argv[3] ?? ".cache/replay-spike");
const { decompress } = await import(
  pathToFileURL(`${cache}/public/vendor/fzstd.mjs`).href
);
const buffer = await Bun.file(process.argv[2]).arrayBuffer();
assert.equal(
  new Bun.CryptoHasher("sha256").update(buffer).digest("hex"),
  FIXTURE_SHA256,
);
const start = performance.now(),
  replay = parseReplay(buffer, decompress);
const hash = new Bun.CryptoHasher("sha256");
for (const packet of replay.movementPayloads) {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(packet.length);
  hash.update(length).update(packet);
}
assert.equal(
  hash.digest("hex"),
  "632d95de2cba6aced80eece2240646880e3b3c05ed2003cdb4a7b3eec8346e69",
);
assert.equal(replay.movementPackets, 27947);
assert.equal(replay.events.length, 105232);
assert.equal(replay.animations.length, 1478);
assert.equal(replay.blocks, 869695);
assert.equal(replay.roster.length, 10);
const mutated = buffer.slice(0);
new Uint8Array(mutated)[15] ^= 1;
assert.throws(() => parseReplay(mutated, decompress), /Unsupported build/);
const protocol = buffer.slice(0);
new Uint8Array(protocol)[6] ^= 1;
assert.throws(
  () => parseReplay(protocol, decompress),
  /Unsupported build\/protocol/,
);
for (const length of [0, 16, 31, 100, buffer.byteLength - 100])
  assert.throws(() => parseReplay(buffer.slice(0, length), decompress));
assert.throws(() => movementBytes(new Uint8Array()), /Truncated/);
assert.throws(() => movementPaths(new Uint8Array(9)), /Truncated/);
assert.throws(() => decodeAnimation(new Uint8Array(2)), /Truncated/);
const delta = Buffer.alloc(19);
delta.writeUInt16LE(6);
delta.writeUInt32LE(1, 2);
delta.writeFloatLE(350, 6);
delta[10] = 15;
delta.writeUInt16LE(100, 11);
delta.writeUInt16LE(200, 13);
delta.set([255, 254, 1, 1], 15);
assert.deepEqual(movementPaths(delta)[0].waypoints, [
  [7558, 7812],
  [7556, 7808],
  [7558, 7810],
]);
const track = [
  {
    time: 10,
    speed: 10,
    waypoints: [
      [0, 0],
      [30, 0],
      [30, 40],
    ],
  },
  { time: 20, speed: 0, waypoints: [[80, 90]] },
];
assert.equal(sampleMovement(track, 9), null);
assert.deepEqual(sampleMovement(track, 15).point, [30, 20]);
assert.deepEqual(sampleMovement(track, 19).point, [30, 40]);
assert.deepEqual(sampleMovement(track, 20).point, [80, 90]);
const tracks = indexMovement(replay.events),
  samples = [0, 120, 480, 495, 510, 1000, replay.duration];
const snapshot = (t) =>
  JSON.stringify(
    [...tracks].map(([id, track]) => [id, sampleMovement(track, t)?.point]),
  );
const expected = samples.map(snapshot);
for (let i = samples.length - 1; i >= 0; i--)
  assert.equal(snapshot(samples[i]), expected[i]);
let oracleNames = 0,
  oracleRates = 0;
if (process.argv[4]) {
  const lines = (
    await Bun.file(`${resolve(process.argv[4])}/animations-oracle.jsonl`).text()
  )
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(lines.length, 1478);
  assert.deepEqual(
    replay.animations.map((e) => [
      e.time,
      e.entityId,
      e.opcode,
      e.animationName,
    ]),
    lines
      .sort((a, b) => a.time - b.time)
      .map((e) => [e.time, e.entityId, e.opcode, e.fields.animationName]),
  );
  for (const row of lines) {
    const result = decodeAnimation(Buffer.from(row.payload, "hex"));
    assert.equal(result.animationName, row.fields.animationName);
    oracleNames++;
    if (row.finalObjectRate !== undefined) {
      assert.equal(result.rawRate, row.finalObjectRate);
      oracleRates++;
    }
  }
}
console.log(
  JSON.stringify(
    {
      movementPackets: replay.movementPackets,
      movementRecords: replay.events.length,
      animationEvents: replay.animations.length,
      oracleNames,
      oracleRates,
      checks: [
        "full-corpus movement byte digest",
        "build and protocol rejection",
        "truncated data rejection",
        "signed waypoint deltas",
        "absolute-time seeking",
      ],
      milliseconds: Math.round(performance.now() - start),
    },
    null,
    2,
  ),
);
