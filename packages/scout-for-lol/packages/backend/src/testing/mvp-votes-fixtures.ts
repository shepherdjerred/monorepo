import { MatchIdSchema } from "@scout-for-lol/data";
import {
  freezeMatchMvpRosterFromParticipants,
  type MatchMvpRoster,
} from "#src/mvp-votes/roster.ts";
import { bucksTestPuuid } from "#src/testing/bucks-fixtures.ts";

/** Ten-player Flex roster used by MVP vote query, tRPC, and vote tests. */
export function freezeMvpTestRoster(matchId: string): MatchMvpRoster {
  return freezeMatchMvpRosterFromParticipants(
    MatchIdSchema.parse(matchId),
    Array.from({ length: 10 }, (_unused, index) => ({
      participantId: index + 1,
      puuid: bucksTestPuuid(index),
      teamId: index < 5 ? (100 as const) : (200 as const),
      championName: `Champ${String(index)}`,
      riotIdGameName: `Player${String(index)}`,
      riotIdTagline: "NA1",
    })),
  );
}
