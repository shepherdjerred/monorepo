import { expect, test } from "bun:test";
import { foldRecordedInventory } from "./recorded-inventory-fold.mjs";

const participantIds = Array.from({ length: 10 }, (_, i) => 101 + i);
const openingChunkOffset = 250;
const options = { participantIds, openingChunkOffset, durationSeconds: 12 };
const opening = participantIds.map((context) => ({
  opcode: 1214,
  timeSeconds: 0,
  stream: 2,
  chunkOffset: openingChunkOffset,
  context,
  entries:
    context === 101
      ? [
          { slot: 0, itemId: 10, count: 1 },
          { slot: 1, itemId: 20, count: 2 },
          { slot: 12, itemId: 90, count: 1 },
        ]
      : [],
}));
const mutation = (opcode, timeSeconds, fields) => ({
  opcode,
  timeSeconds,
  stream: 1,
  chunkOffset: 300,
  context: 101,
  ...fields,
});
const item = (itemId, count = 1) => ({ itemId, count });

test("folds chronological mutations without restoring later checkpoint state", () => {
  const rows = [
    ...opening,
    mutation(840, 0, { slot: 0, itemId: 11, count: 1 }),
    mutation(840, 0, { slot: 0, itemId: 99, count: 0 }),
    { ...opening[0], chunkOffset: 350, timeSeconds: 1, entries: [] },
    mutation(226, 1, { from: 0, to: 1 }),
    mutation(1143, 2, { slot: 0, count: 1 }),
    mutation(190, 3, { slot: 1, itemId: 11, count: 0 }),
    mutation(840, 3, { slot: 1, itemId: 11, count: 1 }),
    mutation(248, 4, { slot: 1, counter: 12 }),
    mutation(1143, 5, { slot: 5, count: 2 }),
    mutation(797, 6, { slot: 0, count: 0 }),
    mutation(415, 7, { entries: [{ slot: 6, itemId: 12, count: 1 }] }),
  ];
  const result = foldRecordedInventory(rows, { ...options, audit: true });
  expect(foldRecordedInventory(rows, options)).toEqual({
    tracks: result.tracks,
  });
  expect(result.tracks[0]).toEqual({
    participantId: 101,
    points: [
      [0, [item(11), item(20, 2), null, null, null, null, null]],
      [1, [item(20, 2), item(11), null, null, null, null, null]],
      [2, [item(20), item(11), null, null, null, null, null]],
      [6, [null, item(11), null, null, null, null, null]],
      [7, [null, null, null, null, null, null, item(12)]],
    ],
  });
  expect(result.rawOpening.get(101)[0]).toEqual(item(10));
  expect(result.expandedTracks.get(101).at(-1)[1][12]).toEqual(item(90));
  expect(result.counts).toEqual({ clears: 1, swaps: 1, fullSnapshots: 1 });
  expect(
    result.tracks.slice(1).every(({ points }) => points.length === 1),
  ).toBe(true);
});

test("requires all unique participants in the exact opening chunk", () => {
  expect(() => foldRecordedInventory(opening.slice(1), options)).toThrow(
    "Incomplete initial native inventory checkpoint",
  );
  expect(() =>
    foldRecordedInventory([...opening, opening[0]], options),
  ).toThrow("Unexpected opening inventory clock or identity");
  expect(() =>
    foldRecordedInventory(opening, { ...options, openingChunkOffset: 251 }),
  ).toThrow("Incomplete initial native inventory checkpoint");
});

test("rejects unordered clocks and mutations without native slot authority", () => {
  const fold = (...rows) =>
    foldRecordedInventory([...opening, ...rows], options);
  expect(() =>
    fold(mutation(248, 3, { slot: 0 }), mutation(248, 2, { slot: 0 })),
  ).toThrow("recorded clock");
  expect(() => fold(mutation(248, 13, { slot: 0 }))).toThrow("recorded clock");
  expect(() => fold(mutation(226, 1, { from: 0, to: 6 }))).toThrow(
    "original playable-item gate",
  );
  expect(() => fold(mutation(797, 1, { slot: 5, count: 2 }))).toThrow(
    "unobserved slot",
  );
  expect(() =>
    fold(mutation(190, 1, { slot: 39, itemId: 10, count: 1 })),
  ).toThrow("outside native storage");
  expect(() =>
    fold(mutation(840, 1, { slot: 0, itemId: 10, count: 256 })),
  ).toThrow("outside native storage");
});
