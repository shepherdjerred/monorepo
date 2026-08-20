import {
  BucksPoolRosterSchema,
  type BucksPoolParticipant,
  type LeaguePuuid,
  type RiotTeamId,
} from "@scout-for-lol/data";
import type { OpenMarketAggregate } from "#src/betting/accounts.ts";
import { BLUE_TEAM_ID, RED_TEAM_ID } from "#src/betting/constants.ts";
import { teamName } from "#src/betting/team.ts";
import { splitMessageIntoChunks } from "#src/discord/utils/message.ts";

type OpenBettingPool = {
  matchId: string;
  roster: string;
};

export type OpenGameAnchor = {
  matchId: string;
  subjectPuuid: LeaguePuuid;
  subjectTeamId: RiotTeamId;
};

export function parseBettingRoster(raw: string): BucksPoolParticipant[] {
  return BucksPoolRosterSchema.parse(JSON.parse(raw)).participants;
}

export function formatGameSelectors(aliases: readonly string[]): string[] {
  return aliases.map((alias) => `game: \`${alias}\``);
}

export function trackedGameAliases(
  roster: readonly BucksPoolParticipant[],
): string[] {
  return roster.flatMap((participant) =>
    participant.trackedAlias === undefined || participant.puuid === null
      ? []
      : [participant.trackedAlias],
  );
}

export function resolveOpenGameByAlias(
  pools: readonly OpenBettingPool[],
  requestedAlias: string,
): OpenGameAnchor | undefined {
  const normalizedAlias = requestedAlias.toLowerCase();
  const matches: OpenGameAnchor[] = [];

  for (const pool of pools) {
    const subject = parseBettingRoster(pool.roster).find(
      (participant) =>
        participant.puuid !== null &&
        participant.trackedAlias?.toLowerCase() === normalizedAlias,
    );
    if (subject !== undefined && subject.puuid !== null) {
      matches.push({
        matchId: pool.matchId,
        subjectPuuid: subject.puuid,
        subjectTeamId: subject.teamId,
      });
    }
  }

  if (matches.length > 1) {
    throw new Error(
      `Tracked alias ${requestedAlias} matched ${matches.length.toString()} open Bryan Bucks pools`,
    );
  }
  return matches[0];
}

export function buildOpenMarketSections(
  pools: readonly OpenMarketAggregate[],
): string[] {
  return pools.map((pool) => {
    const closesAtUnix = Math.floor(pool.closesAt.getTime() / 1000);
    const blueSelectors = formatGameSelectors(pool.blue.trackedPlayers);
    const redSelectors = formatGameSelectors(pool.red.trackedPlayers);
    const bluePlayers =
      blueSelectors.length > 0
        ? blueSelectors.join(", ")
        : "No tracked players";
    const redPlayers =
      redSelectors.length > 0 ? redSelectors.join(", ") : "No tracked players";
    return [
      `## ${bluePlayers} vs ${redPlayers}`,
      `Closes <t:${closesAtUnix.toString()}:R>`,
      `🔵 **${teamName(BLUE_TEAM_ID)}:** ${pool.blue.totalStake.toString()} BB across ${pool.blue.betCount.toString()} bet(s) — ${bluePlayers}`,
      `🔴 **${teamName(RED_TEAM_ID)}:** ${pool.red.totalStake.toString()} BB across ${pool.red.betCount.toString()} bet(s) — ${redPlayers}`,
    ].join("\n");
  });
}

export function buildUnknownGameReplyChunks(
  requestedAlias: string,
  availableAliases: readonly string[],
): string[] {
  return splitMessageIntoChunks(
    [
      `No open game for **${requestedAlias}**. Valid game aliases:`,
      ...availableAliases.map((alias) => `- \`${alias}\``),
    ].join("\n"),
  );
}
