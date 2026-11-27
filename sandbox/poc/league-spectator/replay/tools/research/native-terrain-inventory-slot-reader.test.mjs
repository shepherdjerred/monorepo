import { expect, test } from "bun:test";
import { createCurrentInventorySlotReader } from "./native-terrain-inventory-slot-reader.mjs";

const identity = Uint8Array.from({ length: 256 }, (_, byte) => byte);
const read = createCurrentInventorySlotReader(identity);

test.each([
  [226, [0, 20, 247], { from: 1, to: 5 }],
  [797, [0, 0, 1, 2, 3, 4, 24], { slot: 6, count: 231 }],
  [1143, [4, 1, 28, 172, 107], { slot: 0, count: 7, counter: 257 }],
  [248, [0, 6, 8, 248], { slot: 0, counter: 257 }],
])(
  "reads exact opcode %i fields and requires the complete body",
  (opcode, bytes, fields) => {
    const body = Uint8Array.from(bytes);
    expect(read(opcode, body)).toEqual(fields);
    expect(() => read(opcode, body.subarray(0, -1))).toThrow();
    expect(() => read(opcode, Uint8Array.of(...body, 0))).toThrow();
  },
);

test("rejects unsupported mutations and count layouts", () => {
  expect(() => read(309, Uint8Array.of(0))).toThrow(
    "Unsupported inventory mutation",
  );
  expect(() => read(797, Uint8Array.of(3, 0, 0, 0, 0, 0, 0))).toThrow("layout");
  expect(() => read(797, Uint8Array.of(128, 0, 0, 0, 0, 0, 0))).toThrow(
    "layout",
  );
  expect(() => read(226, Uint8Array.of(0, 255, 0))).toThrow("slot exceeds");
});

test("rejects unterminated and overflowing counter varints", () => {
  expect(() => read(248, Uint8Array.of(0, 2, 2, 2, 0))).toThrow("out-of-range");
  expect(() => read(248, Uint8Array.of(0, 2, 2, 16, 248))).toThrow(
    "out-of-range",
  );
});

test("requires an immutable copy of a complete substitution permutation", () => {
  expect(() => createCurrentInventorySlotReader(identity.subarray(1))).toThrow(
    "256-byte",
  );
  expect(() => createCurrentInventorySlotReader(new Uint8Array(256))).toThrow(
    "permutation",
  );
  const source = identity.slice();
  const reader = createCurrentInventorySlotReader(source);
  source.fill(0);
  expect(reader(226, Uint8Array.of(0, 20, 247))).toEqual({ from: 1, to: 5 });
});
