import type { LeaguePuuid } from "@scout-for-lol/data";
import type { MatchMvpRoster } from "#src/mvp-votes/roster.ts";

/**
 * Web and Explore naming: guild alias when the nominee is tracked here,
 * otherwise the frozen roster Riot ID. Discord markdown sanitizing stays in
 * the Discord tally path.
 */
export function mvpQueryDisplayName(
  puuid: LeaguePuuid,
  roster: MatchMvpRoster,
  aliases: ReadonlyMap<LeaguePuuid, string>,
): string {
  const alias = aliases.get(puuid);
  if (alias !== undefined && alias.trim().length > 0) {
    return alias.trim();
  }
  const participant = roster.participants.find(
    (entry) => entry.puuid === puuid,
  );
  if (participant === undefined) {
    throw new Error(
      `Match MVP query asked to name ${puuid}, who is not on the frozen roster`,
    );
  }
  return participant.riotId;
}
