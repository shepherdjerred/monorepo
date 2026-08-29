import { LeaguePuuidSchema } from "@scout-for-lol/data/index.ts";
import { getRiotIdByPuuid } from "#src/lib/riot/account-riot-id.ts";
import type { TournamentLobbyRecord } from "#src/league/tournament/lobby-store.ts";

/**
 * Resolves the people Riot says joined an open lobby for a team-neutral card.
 *
 * Tournament lobby events expose encrypted PUUIDs, not display names. Those
 * identifiers are enough to ask the Account API for Riot IDs, but are never
 * sent to Discord. A partial roster would imply that the omitted player had
 * not joined, so any lookup failure returns no names and lets the card show its
 * exact joined-player count instead.
 */
export async function resolveLobbyPlayerNames(
  lobby: TournamentLobbyRecord,
): Promise<readonly string[] | undefined> {
  const identities = await Promise.all(
    lobby.joinedPuuids.map(async (puuid) =>
      getRiotIdByPuuid(LeaguePuuidSchema.parse(puuid), lobby.region),
    ),
  );
  if (identities.some((identity) => identity === null)) {
    return undefined;
  }

  return identities.map((identity) => {
    if (identity === null) {
      throw new Error("A missing Riot ID passed complete lobby enrichment.");
    }
    return `${identity.gameName}#${identity.tagLine}`;
  });
}
