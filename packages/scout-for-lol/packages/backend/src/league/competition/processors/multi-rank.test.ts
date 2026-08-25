import { describe, expect, test } from "vitest";
import {
  AccountIdSchema,
  PlayerIdSchema,
  rankToLeaguePoints,
  type Rank,
} from "@scout-for-lol/data";
import { processHighestRank } from "#src/league/competition/processors/highest-rank.ts";
import { processMostRankClimb } from "#src/league/competition/processors/most-rank-climb.ts";
import type { PlayerWithAccounts } from "#src/league/competition/processors/types.ts";
import { testAccountId, testPuuid } from "#src/testing/test-ids.ts";

const player: PlayerWithAccounts = {
  id: PlayerIdSchema.parse(1),
  alias: "Multi-ladder player",
  discordId: testAccountId("90000001"),
  accounts: [
    {
      id: AccountIdSchema.parse(1),
      alias: "Multi-ladder player",
      puuid: testPuuid("multi-rank"),
      region: "AMERICA_NORTH",
    },
  ],
};

function rank(
  tier: Rank["tier"],
  division: Rank["division"],
  lp: number,
): Rank {
  return { tier, division, lp, wins: 20, losses: 18 };
}

const goldIV = rank("gold", 4, 10);
const platinumII = rank("platinum", 2, 10);
const platinumI = rank("platinum", 1, 75);
const diamondIV = rank("diamond", 4, 10);
const diamondIII = rank("diamond", 3, 40);
const diamondII = rank("diamond", 2, 80);

describe("multi-ladder highest rank", () => {
  test("uses the best selected ladder for MAX, including Ranked 5s", () => {
    const result = processHighestRank(
      [player],
      {
        type: "HIGHEST_RANK",
        aggregation: "MAX",
        queues: ["solo", "flex", "ranked 5s"],
      },
      {
        [player.id]: {
          solo: platinumI,
          flex: diamondIII,
          ranked5s: diamondII,
        },
      },
    );

    expect(result[0]?.score).toEqual(diamondII);
    expect(result[0]?.metadata?.["winningQueue"]).toBe("ranked 5s");
  });

  test("sums available ladders and ignores missing ladders", () => {
    const result = processHighestRank(
      [player],
      {
        type: "HIGHEST_RANK",
        aggregation: "SUM",
        queues: ["solo", "flex", "ranked 5s"],
      },
      { [player.id]: { solo: platinumI, ranked5s: diamondII } },
    );

    expect(result[0]?.score).toBe(
      rankToLeaguePoints(platinumI) + rankToLeaguePoints(diamondII),
    );
  });
});

describe("multi-ladder rank climb", () => {
  test("uses the largest complete climb for MAX when every climb is negative", () => {
    const result = processMostRankClimb(
      [player],
      {
        type: "MOST_RANK_CLIMB",
        aggregation: "MAX",
        queues: ["solo", "flex", "ranked 5s"],
      },
      { [player.id]: { solo: diamondII, ranked5s: platinumI } },
      { [player.id]: { solo: diamondIII, ranked5s: platinumII } },
    );
    const soloChange =
      rankToLeaguePoints(diamondIII) - rankToLeaguePoints(diamondII);
    const ranked5sChange =
      rankToLeaguePoints(platinumII) - rankToLeaguePoints(platinumI);

    expect(result[0]?.score).toBe(Math.max(soloChange, ranked5sChange));
    expect(result[0]?.metadata?.["winningQueue"]).toBe(
      soloChange > ranked5sChange ? "solo" : "ranked 5s",
    );
  });

  test("sums complete selected-ladder changes and ignores incomplete ladders", () => {
    const result = processMostRankClimb(
      [player],
      {
        type: "MOST_RANK_CLIMB",
        aggregation: "SUM",
        queues: ["solo", "flex", "ranked 5s"],
      },
      {
        [player.id]: {
          solo: goldIV,
          flex: platinumII,
          ranked5s: platinumII,
        },
      },
      { [player.id]: { solo: diamondIV, ranked5s: platinumI } },
    );

    expect(result[0]?.score).toBe(
      rankToLeaguePoints(diamondIV) -
        rankToLeaguePoints(goldIV) +
        rankToLeaguePoints(platinumI) -
        rankToLeaguePoints(platinumII),
    );
  });
});
