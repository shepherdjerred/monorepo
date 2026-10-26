import {
  freezeMatchMvpRosterFromParticipants,
  type MatchMvpRoster,
} from "#src/mvp-votes/roster.ts";
import { leagueTestPuuid } from "#src/testing/league-fixtures.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";

/** Ten-player Flex roster used by MVP vote query, tRPC, and vote tests. */
export function freezeMvpTestRoster(matchId: RiotMatchId): MatchMvpRoster {
  return freezeMatchMvpRosterFromParticipants(
    matchId,
    Array.from({ length: 10 }, (_unused, index) => ({
      participantId: index + 1,
      puuid: leagueTestPuuid(index),
      teamId: index < 5 ? (100 as const) : (200 as const),
      championName: `Champ${String(index)}`,
      riotIdGameName: `Player${String(index)}`,
      riotIdTagline: "NA1",
    })),
  );
}
