import assert from "node:assert/strict";
import test from "node:test";
import {
  rotateByteLeft as rotate,
  swapAdjacentBits as swap,
} from "./native-terrain-byte-codecs.mjs";
import { readCurrentNeutralRequestedSkinId as read } from "./recorded-current-neutral-skin-reader.mjs";

const identity = Uint8Array.from({ length: 256 }, (_, byte) => byte);
const encodeNameLength = (length) => swap(rotate(length ^ 0xa6, 7));
const encodeSkinByte = (byte) =>
  swap((0xec - rotate(byte ^ 255, 3)) & 255) ^ 0x87;

function body(selector, ...skinBytes) {
  const payload = new Uint8Array(28 + skinBytes.length);
  payload[1] = selector << 4;
  payload[2] = 2 << 4; // Both intervening strings use native empty defaults.
  payload[3] = 3 << 2; // The intervening scalar is implicit.
  payload[26] = encodeNameLength(1);
  payload.set(skinBytes.map(encodeSkinByte), 28);
  return payload;
}

test("reads implicit and explicit neutral factory skin values", () => {
  for (const [selector, expected] of [
    [1, 1],
    [2, 2],
    [3, 0],
    [5, 0xffffffff],
  ])
    assert.equal(read(body(selector), identity), expected);
  for (const selector of [0, 4, 6, 7])
    assert.equal(read(body(selector, 0x84, 1), identity), 132);
});

test("declines incomplete or overflowing explicit skin records", () => {
  assert.equal(read(body(0), identity), undefined);
  assert.equal(read(body(4, 0x80), identity), undefined);
  assert.equal(
    read(body(7, 0x80, 0x80, 0x80, 0x80, 0x10), identity),
    undefined,
  );
  const truncatedName = body(6, 4);
  truncatedName[26] = encodeNameLength(16);
  assert.equal(read(truncatedName, identity), undefined);
});
