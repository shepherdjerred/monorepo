import { describe, expect, test } from "vitest";
import { testLaneResultRow } from "#src/testing/report-lake/test-lane-results.ts";
import {
  attributeMatchupGames,
  tallyMatchupGames,
} from "#src/trpc/router/consumer/champion-matchup/matchup-tally.ts";
import type { ChampionPagePerson } from "#src/trpc/router/consumer/consumer-champion-people.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";

const main = testPuuid("tally-main");
const alt = testPuuid("tally-alt");
const friend = testPuuid("tally-friend");

function person(
  playerId: number,
  isViewer: boolean,
  puuids: (typeof main)[],
): ChampionPagePerson {
  return {
    playerId,
    alias: `Player ${playerId.toString()}`,
    isViewer,
    guilds: [{ guildId: testGuildId("1"), name: "Server" }],
    puuids,
  };
}

const people = [person(1, true, [main, alt]), person(2, false, [friend])];

describe("matchup tally", () => {
  test("counts ahead of the games that have a checkpoint, strictly", () => {
    const games = attributeMatchupGames(
      [
        testLaneResultRow({ matchId: 1, puuid: main, goldDiff: 300 }),
        testLaneResultRow({ matchId: 2, puuid: main, goldDiff: 0 }),
        testLaneResultRow({ matchId: 3, puuid: alt, goldDiff: -50 }),
        testLaneResultRow({
          matchId: 4,
          puuid: main,
          goldDiff: null,
          win: false,
        }),
      ],
      people,
    );
    expect(tallyMatchupGames(games)).toEqual({
      games: 4,
      wins: 3,
      // The game with no checkpoint is in the record, not the ahead figure.
      ahead15: { games: 3, ahead: 1 },
    });
  });

  test("counts a person's match once, however many accounts were in it", () => {
    const games = attributeMatchupGames(
      [
        testLaneResultRow({ matchId: 1, puuid: main, goldDiff: 100 }),
        testLaneResultRow({ matchId: 1, puuid: alt, goldDiff: 100 }),
        testLaneResultRow({ matchId: 1, puuid: friend, goldDiff: 100 }),
      ],
      people,
    );
    expect(games.map((game) => game.isViewer)).toEqual([true, false]);
  });

  test("rejects a row for an account nobody on the page owns", () => {
    expect(() =>
      attributeMatchupGames(
        [testLaneResultRow({ matchId: 1, puuid: null, goldDiff: 1 })],
        people,
      ),
    ).toThrow("unrequested player");
  });
});
