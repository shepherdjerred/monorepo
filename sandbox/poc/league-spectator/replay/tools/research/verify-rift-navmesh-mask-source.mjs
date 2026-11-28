import assert from "node:assert/strict";
import { directNavmeshMask4x } from "../../latest-direct-navmesh-mask.mjs";

const [receiptPath] = process.argv.slice(2);
assert(
  receiptPath,
  "Supply a private receipt from probe-rift-navmesh-mask-source.py",
);
const receipt = await Bun.file(receiptPath).json();
assert.equal(receipt.kind, "initial-map11-native-mask-source");
assert.equal(receipt.build, "16.23.841.8428");
assert.equal(
  receipt.navgridSha256,
  "28f6738003e01a0c13fa8a2f859d2947a8743606465b42139a24c423dd311bd9",
);
const { width, height } = receipt.rgba;
assert.deepEqual([width, height], [295, 296]);
const rgba = Uint8Array.fromHex(receipt.rgba.hex);
const previous = new Uint8Array(width * height * 16);
const sha = (bytes) => Bun.CryptoHasher.hash("sha256", bytes, "hex");
assert.equal(sha(rgba), receipt.rgba.sha256);
assert.equal(rgba.length, width * height * 4);
assert.equal(sha(previous), receipt.expanded.previousSha256);

const native = Uint8Array.fromHex(receipt.expanded.hex);
const translated = directNavmeshMask4x({ width, height, rgba, previous });
assert.deepEqual(
  [translated.width, translated.height],
  [receipt.expanded.width, receipt.expanded.height],
);
assert.equal(sha(native), receipt.expanded.sha256);
assert.equal(Buffer.compare(translated.bytes, native), 0);
console.log(
  `Compared ${native.length} initial Map11 expanded mask bytes against the archived writer.`,
);
