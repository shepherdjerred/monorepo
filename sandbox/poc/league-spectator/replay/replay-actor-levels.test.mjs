import { expect, test } from "bun:test";
import { decodeActorLevelEnvelopes } from "./replay-actor-levels.mjs";

const binding = {
  verified: [
    { context: 500, footerRow: 3 },
    { context: 501, footerRow: 4 },
  ],
  unresolved: [502, 503, 504, 505, 506, 507, 508, 509],
};
const initialPackets = Array.from({ length: 10 }, (_, index) => ({
  stream: 2,
  chunkOffset: 100,
  blockOffset: index,
  explicitOpcode: 313,
  marker: 1,
  paramBits: 500 + index,
  payload: new Uint8Array(1263),
}));
function level(context, timeSeconds, secondTimeBits, values, opcode = 1011) {
  return {
    stream: 1,
    chunkOffset: 200,
    blockOffset: timeSeconds * 1000,
    explicitOpcode: opcode,
    marker: 1,
    paramBits: context,
    timeSeconds,
    secondTimeBits,
    payload: new Uint8Array(values),
  };
}
const expected = [2, 1, 3, 3, 1, 1, 1, 1, 1, 1];

test("preserves same-clock startup levels and does not fill unresolved bindings", () => {
  const result = decodeActorLevelEnvelopes(
    [
      ...initialPackets,
      level(500, 0.5, 100, [0x82]),
      level(500, 0.5, 100, [0x08, 0x16, 0x72]),
      level(501, 30, 200, [0x85]),
      level(502, 35, 210, [0x85]),
      level(501, 90, 300, [0x08, 0x72]),
    ],
    binding,
    expected,
  );
  expect(result.initialLevel).toBe(1);
  expect(
    result.events.map(({ footerRow, level, secondTimeBits }) => [
      footerRow,
      level,
      secondTimeBits,
    ]),
  ).toEqual([
    [3, 2, 100],
    [3, 3, 100],
    [4, 2, 200],
    [null, 2, 210],
    [4, 3, 300],
  ]);
});

test("rejects wrong clocks, level codes, sequences and incomplete progressions", () => {
  const attempt = (...events) =>
    decodeActorLevelEnvelopes(
      [...initialPackets, ...events],
      binding,
      expected,
    );
  expect(() =>
    attempt(
      level(500, 0.5, 100, [0x82]),
      level(500, 0.5, 101, [0x00, 0x16, 0x72]),
    ),
  ).toThrow("Unrecognized or nonconsecutive");
  expect(() =>
    attempt(level(500, 30, 200, [0x85]), level(500, 90, 300, [0x00, 0xc5])),
  ).toThrow("Unrecognized or nonconsecutive");
  expect(() => attempt(level(500, 0.5, 100, [0x82]))).toThrow(
    "Incomplete opening level progression",
  );
  expect(() => attempt()).toThrow("differs from the bound footer row");
});
