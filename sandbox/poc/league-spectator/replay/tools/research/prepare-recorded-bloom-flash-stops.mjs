import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { openReplay } from "../../transport.mjs";
import { codecsFromTerrainByteMaps } from "./native-terrain-byte-codecs.mjs";
import {
  createRecordedRiftStopReader,
  readRecordedRiftEffectPackets,
} from "./recorded-rift-effect-packets.mjs";

const [replayPath, codecPath, inventoryPath, output, ...extra] =
  process.argv.slice(2);
assert.ok(
  output && extra.length === 0,
  "Supply the Bloom replay, terrain byte maps, native create inventory, and fresh private .cache output",
);
const [cache, parent] = await Promise.all([
  realpath(".cache"),
  realpath(dirname(output)),
]);
const privatePath = relative(cache, parent);
assert.ok(
  !isAbsolute(privatePath) && privatePath.split(/[\\/]/u, 1)[0] !== "..",
);

const [replayBytes, codecBytes, inventoryBytes] = await Promise.all([
  Bun.file(replayPath).arrayBuffer(),
  readFile(codecPath),
  readFile(inventoryPath),
]);
const sha256 = (bytes) => Bun.CryptoHasher.hash("sha256", bytes, "hex");
const replaySha256 = sha256(replayBytes);
const inventorySha256 = sha256(inventoryBytes);
assert.equal(
  replaySha256,
  "4bb0f94d3ceb19df374c0937a9e59dcc866a5b92e4727b81c6c7d5b3aca970b7",
);
assert.equal(
  sha256(codecBytes),
  "14d1c21833a71917e12ff44a3ae8d9a6c40ee2401d94f0b3824991022c1c124c",
);
assert.equal(
  inventorySha256,
  "3dd85bb866a6699d3e4b3e1f76ca712a9e468aaf5adfafacc7b0f279f6a4c90f",
);

const replay = openReplay(replayBytes);
const inventory = JSON.parse(inventoryBytes);
assert.equal(inventory.replaySha256, replaySha256);
assert.equal(inventory.build, replay.build);
assert.equal(inventory.protocol, replay.protocol);
const events = inventory.events.filter(
  ({ owner, resourceKey }) =>
    owner === 1073741897 && resourceKey === 0x7f1dcbdc,
);
const handles = new Set(events.map(({ handle }) => handle));
assert.equal(events.length, 2148);
assert.equal(handles.size, events.length);
const first = events[0].stamp;
const last = 1121;
assert.ok(last >= events.at(-1).stamp + 0.6500000357627869);

const decodeStop = createRecordedRiftStopReader(
  replay,
  codecsFromTerrainByteMaps(codecBytes),
);
const inflate = (input, buffer) =>
  zstdDecompressSync(input, { maxOutputLength: buffer.length });
let requestedStopPackets = 0;
for (const {
  kind,
  timeSeconds,
  sequence,
  payload,
} of readRecordedRiftEffectPackets(replay, inflate)) {
  if (timeSeconds > last) break;
  if (kind !== "stop" || timeSeconds < first) continue;
  const request = decodeStop(payload);
  assert.ok(
    request,
    `Invalid stop packet ${sequence} in the Flash lifetime window`,
  );
  assert.ok(
    !handles.has(request.target),
    `Recorded Flash handle ${request.target} received a stop at ${timeSeconds}`,
  );
  requestedStopPackets++;
}
assert.equal(requestedStopPackets, 94373);
const result = {
  replaySha256,
  first,
  last,
  inventorySha256,
  targetHandles: [...handles].sort((a, b) => a - b),
  requestedStopPackets,
  matching: [],
  events,
  early: [],
};
const bytes = JSON.stringify(result, null, 2);
await writeFile(output, bytes, { flag: "wx" });
console.log(
  JSON.stringify({ path: output, sha256: sha256(bytes), requestedStopPackets }),
);
