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

test("admits recorded level 19 only after an exact actor cap override", () => {
  const progression = [
    level(500, 10, 10, [0x85]),
    ...[
      0x72, 0xc5, 0x51, 0x5e, 0x9d, 0x43, 0x5f, 0x81, 0x94, 0xf8, 0x9a, 0x89,
      0xae, 0x8f, 0x93, 0xef, 0x7c,
    ].map((code, index) => level(500, index + 20, index + 20, [0x8d, code])),
  ];
  const cap = level(500, 11, 11, [0x4f, 0x7e], 652);
  const expectedLevels = [1, 1, 19, 1, 1, 1, 1, 1, 1, 1];
  const read = (packets, maximumLevel = 19) =>
    decodeActorLevelEnvelopes(packets, binding, expectedLevels, maximumLevel);
  const [first, ...later] = progression;
  const repeatNine = level(500, 26.5, 27, [0xaa, 0x5f]);
  const events = read([
    first,
    cap,
    ...later.slice(0, 7),
    repeatNine,
    ...later.slice(7),
  ]).events;
  expect(events.at(-1)?.level).toBe(19);
  expect(events.filter((event) => event.level === 9)).toHaveLength(1);
  expect(() => read(progression)).toThrow("Unrecognized or nonconsecutive");
  expect(() => read([first, cap, ...later], 18)).toThrow(
    "Unrecognized or nonconsecutive",
  );
});

test("preserves the current three-byte ordinary transition to level six", () => {
  const progression = [
    level(500, 30, 200, [0x85]),
    ...[0x72, 0xc5, 0x51].map((code, index) =>
      level(500, 90 + index, 300 + index, [0x8d, code]),
    ),
  ];
  const read = (payload, maximumLevel) =>
    decodeActorLevelEnvelopes(
      [...progression, level(500, 178.553, 450, payload)],
      binding,
      [1, 1, 6, 1, 1, 1, 1, 1, 1, 1],
      maximumLevel,
    );
  expect(read([0x89, 0x16, 0x5e], 20).events.at(-1)?.level).toBe(6);
  expect(() => read([0x89, 0x16, 0x5e], 19)).toThrow("nonconsecutive");
  expect(() => read([0x88, 0x16, 0x5e], 20)).toThrow("nonconsecutive");
  expect(() => read([0x89, 0x16, 0x9d], 20)).toThrow("nonconsecutive");
});

test("the current-build profile requires a two-byte level-20 transition and cap", () => {
  const progression = [
    level(500, 10, 10, [0x85]),
    ...[
      0x72, 0xc5, 0x51, 0x5e, 0x9d, 0x43, 0x5f, 0x81, 0x94, 0xf8, 0x9a, 0x89,
      0xae, 0x8f, 0x93, 0xef, 0x7c,
    ].map((code, index) => level(500, index + 20, index + 20, [0x8d, code])),
  ];
  const cap = level(500, 5, 5, [0x4d, 0x7e], 652);
  const level20 = level(500, 40, 40, [0xb2, 0x53]);
  const expectedLevels = [1, 1, 20, 1, 1, 1, 1, 1, 1, 1];
  const read = (packets, maximumLevel = 20) =>
    decodeActorLevelEnvelopes(packets, binding, expectedLevels, maximumLevel);
  expect(read([cap, ...progression, level20]).events.at(-1)?.level).toBe(20);
  expect(() => read([...progression, level20])).toThrow(
    "Unrecognized or nonconsecutive",
  );
  expect(() => read([cap, ...progression, level20], 19)).toThrow(
    "Unrecognized or nonconsecutive",
  );
  expect(() =>
    read([cap, ...progression, level(500, 40, 40, [0x89, 0x16, 0x53])]),
  ).toThrow("Unrecognized or nonconsecutive");
});
