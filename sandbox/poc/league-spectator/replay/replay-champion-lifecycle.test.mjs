import { expect, test } from "bun:test";
import {
  ChampionReturnValidationError,
  validateChampionReturns,
} from "./replay-champion-lifecycle.mjs";

const context = 101;
const verified = [{ context, footerRow: 1 }];
const death = (timeSeconds) => ({
  kind: "champion-death",
  context,
  partition: 0,
  timeSeconds,
});
const candidate = (timeSeconds, payloadBytes = 13) => ({
  context,
  timeSeconds,
  payloadBytes,
  secondTimeBits: 123,
});

test("verifies both return widths against completed intervals and omits the unfinished tail", () => {
  const combat = { verified, events: [death(10), death(30), death(50)] };
  const entries = validateChampionReturns(
    combat,
    [candidate(19.75), candidate(40.75, 9)],
    [20],
    55,
  );
  expect(entries).toEqual([
    {
      kind: "champion-return",
      context,
      partition: 0,
      timeSeconds: 19.75,
      secondTimeBits: 123,
    },
    {
      kind: "champion-return",
      context,
      partition: 0,
      timeSeconds: 40.75,
      secondTimeBits: 123,
    },
  ]);
});

test("accepts no returns for a no-death replay and rejects an outside-context packet", () => {
  const combat = { verified: [], events: [] };
  expect(validateChampionReturns(combat, [], [0], 55)).toEqual([]);
  expect(() =>
    validateChampionReturns(combat, [candidate(10)], [0], 55),
  ).toThrow(ChampionReturnValidationError);
  expect(() =>
    validateChampionReturns(combat, [candidate(10)], [0], 55),
  ).toThrow("no unpaired verified death");
});

test("rejects wrong width, duplicates, bad bounds and incorrect footer accounting", () => {
  const combat = { verified, events: [death(10), death(30), death(50)] };
  const check =
    (candidates, expected = 0) =>
    () =>
      validateChampionReturns(combat, candidates, [expected], 55);
  expect(check([candidate(19, 14)])).toThrow("envelope width");
  expect(check([candidate(19), candidate(20)])).toThrow(
    "outside its verified death interval",
  );
  expect(check([candidate(56)])).toThrow("outside its verified death interval");
  expect(check([candidate(35)])).toThrow("outside its verified death interval");
  expect(check([candidate(19)])).toThrow("nonterminal verified death");
  expect(check([candidate(19), candidate(40)], 18)).toThrow("footer dead time");
});
