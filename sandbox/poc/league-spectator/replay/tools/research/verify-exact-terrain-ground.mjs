import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createNavgridGroundHeight } from "./native-terrain-ground.mjs";

const [scenePath, heightsPath, requestsPath, receiptPath] =
  process.argv.slice(2);
assert.ok(
  scenePath && heightsPath && requestsPath && receiptPath,
  "Usage: bun verify-exact-terrain-ground.mjs <scene.json> <heights.bin> <requests.json> <native-receipt.json>",
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const [scene, heights, requests, receipt] = await Promise.all(
  [scenePath, heightsPath, requestsPath, receiptPath].map((path) =>
    readFile(path),
  ),
);
const { identity, mapBounds, navgrid } = JSON.parse(scene.toString("utf8"));
const points = JSON.parse(requests.toString("utf8"));
const { build, decoderSha256, requestsSha256, map11, queries } = JSON.parse(
  receipt.toString("utf8"),
);
assert.equal(build, "16.23.840.6595");
assert.equal(build, identity.build);
assert.equal(
  decoderSha256,
  "639a6d2ec167f177b8b7766f9aaaa21c0ace07fd6ff084512794166adda0fc15",
);
assert.equal(
  map11.sha256,
  "28f6738003e01a0c13fa8a2f859d2947a8743606465b42139a24c423dd311bd9",
);
assert.equal(sha256(heights), map11.groundCellsSha256);
assert.equal(sha256(requests), requestsSha256);
assert.deepEqual(mapBounds, { min: map11.minimum, max: map11.maximum });
assert.deepEqual([navgrid.columns, navgrid.rows], map11.dimensions);
assert.deepEqual(navgrid.step, map11.step);
assert.ok(points.length > 0 && points.length === queries.length);
const ground = createNavgridGroundHeight(
  mapBounds,
  navgrid,
  new Float32Array(heights.buffer, heights.byteOffset, heights.length / 4),
);
for (const [index, coords] of points.entries()) {
  const { xz, inside, height } = queries[index];
  assert.deepEqual(xz, coords.map(Math.fround));
  const observed = ground(...coords);
  assert.equal(observed !== null, inside, `Map11 bounds at ${coords}`);
  assert.equal(observed, height, `Map11 height at ${coords}`);
}
console.log(
  JSON.stringify({
    queries: points.length,
    groundCellsSha256: map11.groundCellsSha256,
    nativeReceiptSha256: sha256(receipt),
  }),
);
