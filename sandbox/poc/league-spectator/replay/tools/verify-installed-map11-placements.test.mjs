import { expect, test } from "bun:test";
import {
  readKeyedPlaceableSpan,
  uniqueInstalledOffset,
} from "./verify-installed-map11-placements.mjs";

test("requires the whole record to occur exactly once", () => {
  const record = Buffer.from([1, 2, 3, 4]);
  const close = Buffer.from([1, 2, 3, 5]);
  expect(uniqueInstalledOffset(Buffer.concat([close, record]), record)).toBe(4);
  expect(() => uniqueInstalledOffset(close, record)).toThrow("does not occur");
  expect(() =>
    uniqueInstalledOffset(Buffer.concat([record, record]), record),
  ).toThrow("more than once");
  expect(() =>
    uniqueInstalledOffset(Buffer.from([1, 1, 1]), Buffer.from([1, 1])),
  ).toThrow("more than once");
});

test("checks the archived record boundary and includes the map key", () => {
  const bytes = Buffer.alloc(22);
  bytes.writeUInt32LE(7, 2);
  bytes.writeUInt32LE(99, 6);
  bytes.writeUInt32LE(6, 10);
  bytes.writeUInt16LE(1, 14);
  bytes.writeUInt32LE(338, 16);
  const record = {
    type: "Struct",
    classHash: "00000063",
    fieldSpans: [{ offset: 16, bytes: 4 }],
  };
  expect(readKeyedPlaceableSpan(bytes, 7, record)).toEqual({
    offset: 2,
    bytes: bytes.subarray(2, 20),
  });
  expect(() => readKeyedPlaceableSpan(bytes, 8, record)).toThrow("byte range");
  expect(() =>
    readKeyedPlaceableSpan(bytes, 7, {
      ...record,
      fieldSpans: [{ offset: 16, bytes: 5 }],
    }),
  ).toThrow("byte range");
});
