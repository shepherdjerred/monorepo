import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { LeaguePuuid } from "@scout-for-lol/data";
import type { TestLakeMatchFact } from "#src/testing/report-lake/rows.ts";

/**
 * Recent Ahri games for the friends who play her, for the rich tooltip's
 * Scout block ("6 play her, one is best at 67%"). The champion fixture's own
 * games are dated at the audit's fixed day, outside the 90 days a tooltip
 * reads, and the viewer's recent Ahri games come from the friends fixture.
 * Dated from the seed run, like that fixture.
 *
 * Results oldest first per friend: Quillon is the qualified best friend (12
 * games), Halcyon and TidalWren have smaller samples.
 */

const HOUR_MS = 3_600_000;
const AHRI = { id: 103, name: "Ahri" };

const TOOLTIP_AHRI_GAMES = [
  {
    alias: "Quillon",
    results: ["W", "W", "L", "W", "W", "L", "W", "W", "L", "W", "W", "L"],
  },
  { alias: "Halcyon", results: ["L", "W", "L", "W", "L"] },
  { alias: "TidalWren", results: ["W", "L", "W"] },
] as const;

function matchId(index: number): RiotMatchId {
  return RiotMatchIdSchema.parse(`NA1_${(9_470_000_000 + index).toString()}`);
}

export function designAuditTooltipAhriGames(input: {
  friends: { alias: string; playerId: number; puuid: LeaguePuuid }[];
  now: Date;
}): TestLakeMatchFact[] {
  let index = 0;
  return TOOLTIP_AHRI_GAMES.flatMap((entry) => {
    const friend = input.friends.find((candidate) => {
      return candidate.alias === entry.alias;
    });
    if (friend === undefined) {
      throw new Error(`Design-audit friend ${entry.alias} was not seeded`);
    }
    return entry.results.map((result, game): TestLakeMatchFact => {
      index += 1;
      return {
        playerId: friend.playerId,
        playerAlias: friend.alias,
        matchId: matchId(index),
        puuid: friend.puuid,
        queue: "solo",
        win: result === "W",
        surrendered: false,
        kills: 5 + (game % 4),
        deaths: 2 + (game % 3),
        assists: 7 + (game % 5),
        teamId: 100,
        teamPosition: "MIDDLE",
        championId: AHRI.id,
        championName: AHRI.name,
        gameCreationAt: new Date(
          input.now.getTime() - (game * 9 + 5 + index) * HOUR_MS,
        ),
      };
    });
  });
}
