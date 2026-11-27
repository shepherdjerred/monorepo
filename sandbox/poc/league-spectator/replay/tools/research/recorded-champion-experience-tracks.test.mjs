import { expect, test } from "bun:test";
import {
  createRecordedChampionExperienceAccumulator,
  verifyRecordedChampionExperienceFooter,
} from "./recorded-champion-experience-tracks.mjs";

const ids = Array.from({ length: 10 }, (_, index) => 100 + index);
const opening = ids.map((entityId) => ({ entityId, experience: 0, level: 1 }));
const binding = {
  verified: ids.map((context, index) => ({ context, footerRow: index + 1 })),
  unresolved: [],
};

function footer(levels) {
  const prefix = Buffer.alloc(271);
  prefix.write("RIOT");
  prefix.writeUInt16LE(2, 4);
  const text = Buffer.from(
    JSON.stringify({
      statsJson: JSON.stringify(levels.map((LEVEL) => ({ LEVEL }))),
    }),
  );
  const length = Buffer.alloc(4);
  length.writeUInt32LE(text.length);
  return Buffer.concat([prefix, text, length]);
}

test("retains exact ordered levels, accumulated experience, and authored cap changes", () => {
  const fold = createRecordedChampionExperienceAccumulator(ids, 10);
  fold.observe(0, opening);
  fold.observe(1, [{ entityId: ids[0], experience: 282.5 }]);
  fold.observe(1, [{ entityId: ids[0], level: 2 }]);
  fold.observe(2, [{ entityId: ids[0], level: 2 }]);
  fold.observeCap(3, ids[0], Uint8Array.of(0x4d, 0x7e));
  fold.observe(4, [{ entityId: ids[1], level: 21 }]);
  const tracks = fold.finish();
  expect(tracks[0]).toEqual({
    participantId: ids[0],
    levelCaps: [[3, 20]],
    points: [
      [0, 0, 1],
      [1, 282.5, 2],
    ],
  });
  const final = footer(["2", "21", ...Array(8).fill("1")]);
  expect(() =>
    verifyRecordedChampionExperienceFooter(final, binding, tracks),
  ).not.toThrow();
  expect(() =>
    verifyRecordedChampionExperienceFooter(
      footer(["2", "20", ...Array(8).fill("1")]),
      binding,
      tracks,
    ),
  ).toThrow("differs from the bound replay footer");
});

test("fails closed for incomplete actors, wrong clocks, or invalid XP and level values", () => {
  const fold = createRecordedChampionExperienceAccumulator(ids, 10);
  expect(() => fold.finish()).toThrow(
    "Incomplete recorded champion experience roster",
  );
  fold.observe(1, opening);
  expect(() => fold.observe(0, opening)).toThrow(
    "Invalid recorded champion experience clock",
  );
  expect(() => fold.observe(2, [{ entityId: ids[0], experience: -1 }])).toThrow(
    "Invalid recorded champion progression",
  );
  expect(() => fold.observe(2, [{ entityId: ids[0], level: 256 }])).toThrow(
    "Invalid recorded champion progression",
  );
});
