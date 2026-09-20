import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  type DiscordAccountId,
  type DiscordGuildId,
  type LeaguePuuid,
  type QueueType,
  type RiotTeamId,
} from "@scout-for-lol/data";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { indexOfPuuid, type MatchMvpRoster } from "#src/mvp-votes/roster.ts";

export async function isMvpVotesEnabledForGuild(
  guildId: DiscordGuildId,
): Promise<boolean> {
  return await isPolicyEnabled("mvp_votes_enabled", { server: guildId });
}

export async function shouldAttachFlexMvpVotes(input: {
  queueType: QueueType | undefined;
  targetGuildIds: readonly DiscordGuildId[];
}): Promise<boolean> {
  if (input.queueType !== "flex") {
    return false;
  }
  for (const guildId of input.targetGuildIds) {
    if (await isMvpVotesEnabledForGuild(guildId)) {
      return true;
    }
  }
  return false;
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
 * The linked guild player whose Riot account is in this Flex match, or
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
