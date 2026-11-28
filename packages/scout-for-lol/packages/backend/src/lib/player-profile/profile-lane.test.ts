import { describe, expect, test } from "vitest";
import { testLaneResultRow } from "#src/testing/report-lake/test-lane-results.ts";
import { tallyProfileLane } from "#src/lib/player-profile/profile-lane.ts";
import { laneStanding } from "#src/reports/lanes/ahead-at-15.ts";
import { testPuuid } from "#src/testing/test-ids.ts";

const main = testPuuid("lane-main");
const alt = testPuuid("lane-alt");

describe("tallyProfileLane", () => {
  test("is ahead of the games that have a checkpoint, and leaves out games under 15 minutes", () => {
    expect(
      tallyProfileLane([
        testLaneResultRow({ matchId: 1, puuid: main, goldDiff: 400 }),
        testLaneResultRow({ matchId: 2, puuid: alt, goldDiff: -10 }),
        testLaneResultRow({ matchId: 3, puuid: main, goldDiff: 0 }),
        testLaneResultRow({ matchId: 4, puuid: main, goldDiff: null }),
      ]),
    ).toEqual({ games: 3, ahead: 1 });
  });

  test("counts a match once when two accounts were in it", () => {
    expect(
      tallyProfileLane([
        testLaneResultRow({ matchId: 1, puuid: main, goldDiff: 400 }),
        testLaneResultRow({ matchId: 1, puuid: alt, goldDiff: -400 }),
      ]),
    ).toEqual({ games: 1, ahead: 1 });
  });

  test("no rows is no games", () => {
    expect(tallyProfileLane([])).toEqual({ games: 0, ahead: 0 });
  });
});

describe("laneStanding", () => {
  test("a tie is even, not ahead", () => {
    expect(
      [1, 0, -1, null].map((goldDiff) =>
        laneStanding(testLaneResultRow({ matchId: 1, puuid: main, goldDiff })),
      ),
    ).toEqual(["ahead", "even", "behind", null]);
  });
});
