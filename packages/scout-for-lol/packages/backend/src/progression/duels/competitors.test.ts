import { expect, test } from "vitest";
import { duelCompetitorsUseOneRiotRegion } from "#src/progression/duels/competitors.ts";

test("requires every frozen duel member to share one Riot region", () => {
  expect(
    duelCompetitorsUseOneRiotRegion([
      { members: [{ region: "AMERICA_NORTH" }] },
      { members: [{ region: "AMERICA_NORTH" }] },
    ]),
  ).toBe(true);
  expect(
    duelCompetitorsUseOneRiotRegion([
      { members: [{ region: "AMERICA_NORTH" }] },
      { members: [{ region: "EU_WEST" }] },
    ]),
  ).toBe(false);
  expect(duelCompetitorsUseOneRiotRegion([])).toBe(false);
});
