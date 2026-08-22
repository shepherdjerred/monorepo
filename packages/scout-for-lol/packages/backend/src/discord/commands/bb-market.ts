import {
  BucksPoolRosterSchema,
  type BucksPoolParticipant,
  type LeaguePuuid,
  type RiotTeamId,
} from "@scout-for-lol/data";
import type { OpenMarketAggregate } from "#src/betting/open-market.ts";
import { BLUE_TEAM_ID, RED_TEAM_ID } from "#src/betting/constants.ts";
import {
  hasTrackedPlayersOnBothTeams,
  outcomeLabel,
  type OutcomeFraming,
} from "#src/betting/team.ts";
import { splitMessageIntoChunks } from "#src/discord/utils/message.ts";

type OpenBettingPool = {
  matchId: string;
  roster: string;
};

export type OpenGameAnchor = {
  matchId: string;
  subjectPuuid: LeaguePuuid;
  subjectTeamId: RiotTeamId;
  /** Tracked players on both teams, so `/bb bet outcome:win` is ambiguous. */
  mixedTeams: boolean;
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
    const roster = parseBettingRoster(pool.roster);
    const subject = roster.find(
      (participant) =>
        participant.puuid !== null &&
        participant.trackedAlias?.toLowerCase() === normalizedAlias,
    );
    if (subject !== undefined && subject.puuid !== null) {
      matches.push({
        matchId: pool.matchId,
        subjectPuuid: subject.puuid,
        subjectTeamId: subject.teamId,
        mixedTeams: hasTrackedPlayersOnBothTeams(roster),
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

/**
 * How to name this pool's sides in `/bb open`.
 *
 * The aggregate already splits tracked players by team, so a mixed lobby is
 * visible without reparsing the roster.
 */
function framingForAggregate(pool: OpenMarketAggregate): OutcomeFraming {
  const blueIsTracked = pool.blue.trackedPlayers.length > 0;
  const redIsTracked = pool.red.trackedPlayers.length > 0;
  return {
    anchorTeamId: blueIsTracked ? BLUE_TEAM_ID : RED_TEAM_ID,
    mixedTeams: blueIsTracked && redIsTracked,
  };
}

export function buildOpenMarketSections(
  pools: readonly OpenMarketAggregate[],
): string[] {
  return pools.map((pool) => {
    const closesAtUnix = Math.floor(pool.closesAt.getTime() / 1000);
    const framing = framingForAggregate(pool);
    const players = [...pool.blue.trackedPlayers, ...pool.red.trackedPlayers];
    const title = players.length > 0 ? players.join(", ") : "Untracked lobby";
    const sideEntries: readonly {
      teamId: RiotTeamId;
      side: OpenMarketAggregate["blue"];
    }[] = [
      { teamId: BLUE_TEAM_ID, side: pool.blue },
      { teamId: RED_TEAM_ID, side: pool.red },
    ];
    const sides = sideEntries
      .map(
        (entry) =>
          `${outcomeLabel(entry.teamId, framing)} **${entry.side.totalStake.toString()} BB** (${entry.side.betCount.toString()})`,
      )
      .join(" · ");
    const selector =
      players[0] === undefined ? "" : ` — \`/bb bet game:${players[0]}\``;
    return [
      `**${title}** · closes <t:${closesAtUnix.toString()}:R>`,
      `${sides}${selector}`,
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
