import { describe, expect, test } from "bun:test";
import { filterNewMatches } from "#src/league/api/match-history.ts";
import { MatchIdSchema } from "@scout-for-lol/data/index.ts";

function matchId(id: string) {
  return MatchIdSchema.parse(id);
}

describe("filterNewMatches", () => {
  test("returns gapDetected: false with most recent match when no lastProcessedMatchId", () => {
    const ids = [matchId("NA1_5"), matchId("NA1_4"), matchId("NA1_3")];
    const result = filterNewMatches(ids);

    expect(result.gapDetected).toBe(false);
    expect(result.matchIds).toEqual([matchId("NA1_5")]);
  });

  test("returns gapDetected: false with most recent match when lastProcessedMatchId is null", () => {
    const ids = [matchId("NA1_5"), matchId("NA1_4"), matchId("NA1_3")];
    const result = filterNewMatches(ids, null);

    expect(result.gapDetected).toBe(false);
    expect(result.matchIds).toEqual([matchId("NA1_5")]);
  });

  test("returns gapDetected: false with empty array when lastProcessedMatchId is most recent", () => {
    const ids = [matchId("NA1_5"), matchId("NA1_4"), matchId("NA1_3")];
    const result = filterNewMatches(ids, matchId("NA1_5"));

    expect(result.gapDetected).toBe(false);
    expect(result.matchIds).toEqual([]);
  });

  test("returns gapDetected: false with new matches when lastProcessedMatchId is found", () => {
    const ids = [matchId("NA1_5"), matchId("NA1_4"), matchId("NA1_3")];
    const result = filterNewMatches(ids, matchId("NA1_3"));

    expect(result.gapDetected).toBe(false);
    expect(result.matchIds).toEqual([matchId("NA1_5"), matchId("NA1_4")]);
  });

  test("returns gapDetected: false with single new match", () => {
    const ids = [matchId("NA1_5"), matchId("NA1_4"), matchId("NA1_3")];
    const result = filterNewMatches(ids, matchId("NA1_4"));

    expect(result.gapDetected).toBe(false);
    expect(result.matchIds).toEqual([matchId("NA1_5")]);
  });

  test("returns gapDetected: true with all match IDs when lastProcessedMatchId not found", () => {
    const ids = [matchId("NA1_5"), matchId("NA1_4"), matchId("NA1_3")];
    const result = filterNewMatches(ids, matchId("NA1_1"));

    expect(result.gapDetected).toBe(true);
    expect(result.matchIds).toEqual([
      matchId("NA1_5"),
      matchId("NA1_4"),
      matchId("NA1_3"),
    ]);
  });

  test("returns gapDetected: false with empty input", () => {
    const result = filterNewMatches([], matchId("NA1_1"));

    expect(result.gapDetected).toBe(false);
    expect(result.matchIds).toEqual([]);
  });

  test("returns gapDetected: false with empty input and no lastProcessedMatchId", () => {
    const result = filterNewMatches([]);

    expect(result.gapDetected).toBe(false);
    expect(result.matchIds).toEqual([]);
  });
});
