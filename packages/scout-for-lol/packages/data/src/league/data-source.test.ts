import { describe, expect, test } from "vitest";
import {
  SCOUT_CLIENT_DATA_VERSION,
  matchDataSourceOf,
} from "#src/league/data-source.ts";

describe("matchDataSourceOf", () => {
  test("reads a client-converted match as the Scout Client's", () => {
    expect(matchDataSourceOf({ dataVersion: SCOUT_CLIENT_DATA_VERSION })).toBe(
      "SCOUT_CLIENT",
    );
  });

  test("reads Riot's own version as Riot's", () => {
    expect(matchDataSourceOf({ dataVersion: "2" })).toBe("RIOT");
  });
});
