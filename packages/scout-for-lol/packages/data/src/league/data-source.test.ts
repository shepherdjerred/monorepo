import { describe, expect, test } from "vitest";
import {
  SCOUT_CLIENT_DATA_VERSION,
  SCOUT_CLIENT_END_OF_GAME_DATA_VERSION,
  matchCoverageOf,
  matchDataSourceOf,
} from "#src/league/data-source.ts";

describe("matchDataSourceOf", () => {
  test("reads a client-converted match as the Scout Client's", () => {
    expect(matchDataSourceOf({ dataVersion: SCOUT_CLIENT_DATA_VERSION })).toBe(
      "SCOUT_CLIENT",
    );
  });

  test("reads an end-of-game record as the Scout Client's", () => {
    expect(
      matchDataSourceOf({ dataVersion: SCOUT_CLIENT_END_OF_GAME_DATA_VERSION }),
    ).toBe("SCOUT_CLIENT");
  });

  test("reads Riot's own version as Riot's", () => {
    expect(matchDataSourceOf({ dataVersion: "2" })).toBe("RIOT");
  });
});

describe("matchCoverageOf", () => {
  test.each([
    [SCOUT_CLIENT_END_OF_GAME_DATA_VERSION, "end_of_game"],
    [SCOUT_CLIENT_DATA_VERSION, "complete"],
    ["2", "complete"],
  ])("reads %s as %s", (dataVersion, coverage) => {
    expect(matchCoverageOf({ dataVersion })).toBe(coverage);
  });
});
