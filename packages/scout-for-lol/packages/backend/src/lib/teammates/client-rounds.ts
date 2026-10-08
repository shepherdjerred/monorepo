import {
  MatchIdSchema,
  type LeaguePuuid,
  type MatchId,
  type RawMatch,
  type Region,
} from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { prisma } from "#src/database/index.ts";
import { readSelectedLocalCanonicalMatch } from "#src/scout-client/canonical-match.ts";

export type ClientRound = {
  readonly match: RawMatch;
  readonly region: Region;
  readonly matchId: MatchId;
};

/**
 * The player's most recent matches whose result came from their own Scout
 * Client — games Riot never lists in their match history, like ARAM Mayhem.
 *
 * Only matches the player observed themselves count, matched by the
 * observation's own player rather than any participant, so a teammate's
 * client can't put games into someone else's suggestions.
 */
export async function recentClientRounds(
  accounts: readonly { readonly puuid: LeaguePuuid; readonly region: Region }[],
  limit: number,
): Promise<ClientRound[]> {
  const regionOf = new Map<string, Region>(
    accounts.map((account) => [account.puuid, account.region]),
  );
  const selected = await prisma.scoutClientCanonicalMatch.findMany({
    where: { sourceObservation: { localPuuid: { in: [...regionOf.keys()] } } },
    orderBy: { selectedAt: "desc" },
    take: limit,
    select: {
      riotMatchId: true,
      sourceObservation: { select: { localPuuid: true } },
    },
  });
  const rounds: ClientRound[] = [];
  for (const row of selected) {
    const region = regionOf.get(row.sourceObservation.localPuuid ?? "");
    const match = await readSelectedLocalCanonicalMatch(
      RiotMatchIdSchema.parse(row.riotMatchId),
    );
    if (region === undefined || match === null) continue;
    rounds.push({
      match,
      region,
      matchId: MatchIdSchema.parse(row.riotMatchId),
    });
  }
  return rounds;
}
