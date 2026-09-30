import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  RiotTeamIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
  type LeaguePuuid,
  type QueueType,
  type RiotTeamId,
} from "@scout-for-lol/data";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { indexOfPuuid, type MatchMvpRoster } from "#src/mvp-votes/roster.ts";

export const MIN_TRACKED_PLAYERS_ON_ONE_TEAM = 3;

export async function isMvpVotesEnabledForGuild(
  guildId: DiscordGuildId,
): Promise<boolean> {
  return await isPolicyEnabled("mvp_votes_enabled", { server: guildId });
}

export function isMvpVoteQueue(queueType: QueueType | undefined): boolean {
  return queueType === "flex" || queueType === "ranked 5s";
}

export function hasTrackedSideForMvpVotes(input: {
  participants: readonly { puuid: string; teamId: number }[];
  trackedPuuids: readonly LeaguePuuid[];
}): boolean {
  const tracked = new Set<string>(input.trackedPuuids);
  const counts = new Map<RiotTeamId, number>();
  for (const participant of input.participants) {
    if (!tracked.has(participant.puuid)) {
      continue;
    }
    const teamId = RiotTeamIdSchema.safeParse(participant.teamId);
    if (!teamId.success) {
      continue;
    }
    counts.set(teamId.data, (counts.get(teamId.data) ?? 0) + 1);
  }
  for (const count of counts.values()) {
    if (count >= MIN_TRACKED_PLAYERS_ON_ONE_TEAM) {
      return true;
    }
  }
  return false;
}

export async function shouldAttachMvpVotes(input: {
  queueType: QueueType | undefined;
  targetGuildIds: readonly DiscordGuildId[];
  participants: readonly { puuid: string; teamId: number }[];
  trackedPuuids: readonly LeaguePuuid[];
}): Promise<boolean> {
  // V2 attests one postmatch message for every destination. Furniture that
  // went out because *any* audience guild had the flag would also land in
  // guilds where the flag is off. Require every destination instead.
  if (!isMvpVoteQueue(input.queueType) || input.targetGuildIds.length === 0) {
    return false;
  }
  if (
    !hasTrackedSideForMvpVotes({
      participants: input.participants,
      trackedPuuids: input.trackedPuuids,
    })
  ) {
    return false;
  }
  for (const guildId of input.targetGuildIds) {
    if (!(await isMvpVotesEnabledForGuild(guildId))) {
      return false;
    }
  }
  return true;
}

export type MatchMvpVoter = {
  playerId: number;
  alias: string;
  discordId: DiscordAccountId;
  puuid: LeaguePuuid;
  teamId: RiotTeamId;
  rosterIndex: number;
};

/**
 * The linked guild player whose Riot account is in this match, or
 * undefined if this Discord user did not play it on a tracked account.
 */
export async function findMatchMvpVoter(
  input: {
    serverId: DiscordGuildId;
    discordId: DiscordAccountId;
    roster: MatchMvpRoster;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<MatchMvpVoter | undefined> {
  const serverId = DiscordGuildIdSchema.parse(input.serverId);
  const discordId = DiscordAccountIdSchema.parse(input.discordId);
  const accounts = await prismaClient.account.findMany({
    where: {
      puuid: {
        in: input.roster.participants.map((participant) => participant.puuid),
      },
      player: { serverId, discordId },
    },
    select: {
      puuid: true,
      player: { select: { id: true, alias: true } },
    },
    orderBy: [{ playerId: "asc" }, { id: "asc" }],
  });
  const account = accounts[0];
  if (account === undefined) {
    return undefined;
  }
  const puuid = LeaguePuuidSchema.parse(account.puuid);
  const rosterIndex = indexOfPuuid(input.roster, puuid);
  if (rosterIndex === undefined) {
    throw new Error(
      `Match MVP voter query returned ${puuid} which is not on the frozen roster`,
    );
  }
  const participant = input.roster.participants[rosterIndex];
  if (participant === undefined) {
    throw new Error(
      `Match MVP roster named index ${String(rosterIndex)} for ${puuid} but the slot is empty`,
    );
  }
  return {
    playerId: account.player.id,
    alias: account.player.alias,
    discordId,
    puuid: participant.puuid,
    teamId: participant.teamId,
    rosterIndex,
  };
}

export async function guildAliasesForRoster(
  input: {
    serverId: DiscordGuildId;
    roster: MatchMvpRoster;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<Map<LeaguePuuid, string>> {
  const puuids = input.roster.participants.map(
    (participant) => participant.puuid,
  );
  const accounts = await prismaClient.account.findMany({
    where: { serverId: input.serverId, puuid: { in: [...puuids] } },
    select: { puuid: true, player: { select: { alias: true } } },
  });
  const aliases = new Map<LeaguePuuid, string>();
  for (const account of accounts) {
    aliases.set(account.puuid, account.player.alias);
  }
  return aliases;
}
