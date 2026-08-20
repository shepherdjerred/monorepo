import { ChannelType, type Guild, type VoiceChannel } from "discord.js";
import {
  CustomNightSnapshotSchema,
  type CustomNightSnapshot,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  clearClaimedTeamChannels,
  commitClaimedVoiceArrangement,
} from "#src/customs/voice-claim.ts";
import {
  deleteCreatedTeamChannels,
  PartialTeamChannelsError,
} from "#src/customs/voice-arrangement-utils.ts";
import { errorMessage } from "#src/customs/voice-utils.ts";
import { isMissingChannelError } from "#src/discord/utils/permissions.ts";

export type TeamChannels = {
  teamA: VoiceChannel;
  teamB: VoiceChannel;
};

export type CreatedTeamChannels = {
  teamA: VoiceChannel;
  teamB?: VoiceChannel;
};

export function teamChannelName(team: "A" | "B", gameId: string): string {
  return `Customs • Team ${team} • ${gameId}`;
}

function teamChannelOptions(lobby: VoiceChannel, name: string) {
  const permissionOverwrites = lobby.permissionOverwrites.cache.map(
    (overwrite) => ({
      id: overwrite.id,
      allow: overwrite.allow.bitfield,
      deny: overwrite.deny.bitfield,
    }),
  );
  return {
    name,
    type: ChannelType.GuildVoice,
    parent: lobby.parentId,
    permissionOverwrites,
    reason: "Scout Customs team voice",
  } as const;
}

export async function requireVoiceChannel(
  guild: Guild,
  channelId: string,
): Promise<VoiceChannel> {
  const channel = await guild.channels.fetch(channelId);
  if (channel?.type !== ChannelType.GuildVoice) {
    throw new Error(
      "The configured Customs voice lobby is not a guild voice channel",
    );
  }
  return channel;
}

async function createTeamChannel(
  guild: Guild,
  lobby: VoiceChannel,
  team: "A" | "B",
  gameId: string,
): Promise<VoiceChannel> {
  return await guild.channels.create(
    teamChannelOptions(lobby, teamChannelName(team, gameId)),
  );
}

async function createTeamChannels(
  guild: Guild,
  lobby: VoiceChannel,
  gameId: string,
): Promise<TeamChannels> {
  const teamA = await createTeamChannel(guild, lobby, "A", gameId);
  try {
    const teamB = await createTeamChannel(guild, lobby, "B", gameId);
    return { teamA, teamB };
  } catch (error) {
    throw new PartialTeamChannelsError(
      teamA,
      `Team B voice channel creation failed: ${errorMessage(error)}`,
    );
  }
}

export async function recordTeamChannels(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
  gameId: string;
  claimId: string;
  actorDiscordId: string;
  channels: TeamChannels;
}): Promise<{ applied: boolean; snapshot: CustomNightSnapshot }> {
  return await commitClaimedVoiceArrangement({
    prisma: params.prisma,
    snapshot: params.snapshot,
    gameId: params.gameId,
    claimId: params.claimId,
    actorDiscordId: params.actorDiscordId,
    action: "VOICE_CHANNELS_CREATED",
    payload: {
      teamAVoiceChannelId: params.channels.teamA.id,
      teamBVoiceChannelId: params.channels.teamB.id,
    },
    update: (current) =>
      CustomNightSnapshotSchema.parse({
        ...current,
        teamAVoiceChannelId: params.channels.teamA.id,
        teamBVoiceChannelId: params.channels.teamB.id,
      }),
  });
}

export async function createAndRecordTeamChannels(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
  gameId: string;
  claimId: string;
  actorDiscordId: string;
  guild: Guild;
  lobby: VoiceChannel;
}): Promise<
  | { applied: boolean; snapshot: CustomNightSnapshot }
  | { snapshot: CustomNightSnapshot; channels: TeamChannels }
> {
  const channels = await createTeamChannels(
    params.guild,
    params.lobby,
    params.gameId,
  );
  try {
    const recorded = await recordTeamChannels({ ...params, channels });
    if (!recorded.applied) {
      const cleanupFailures = await deleteCreatedTeamChannels(channels);
      if (cleanupFailures.length > 0)
        throw new Error(
          `Voice channel cleanup failed: ${cleanupFailures.join("; ")}`,
        );
      return recorded;
    }
    return { snapshot: recorded.snapshot, channels };
  } catch (error) {
    const cleanupFailures = await deleteCreatedTeamChannels(channels);
    if (cleanupFailures.length > 0)
      throw new Error(
        `${errorMessage(error)}; Voice channel cleanup failed: ${cleanupFailures.join("; ")}`,
        { cause: error },
      );
    throw error;
  }
}

export async function recoverPartialTeamChannels(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
  gameId: string;
  claimId: string;
  actorDiscordId: string;
  guild: Guild;
  lobby: VoiceChannel;
  teamAChannelId: string;
}): Promise<
  | { applied: boolean; snapshot: CustomNightSnapshot }
  | { snapshot: CustomNightSnapshot; channels: TeamChannels }
> {
  let teamA: VoiceChannel;
  try {
    teamA = await requireVoiceChannel(params.guild, params.teamAChannelId);
  } catch (error) {
    if (!isMissingChannelError(error)) throw error;
    const cleared = await clearClaimedTeamChannels({
      ...params,
      teamAVoiceChannelId: params.teamAChannelId,
      teamBVoiceChannelId: null,
    });
    if (!cleared.applied) return cleared;
    return await createAndRecordTeamChannels({
      ...params,
      snapshot: cleared.snapshot,
    });
  }
  const teamB = await createTeamChannel(
    params.guild,
    params.lobby,
    "B",
    params.gameId,
  );
  try {
    const recorded = await recordTeamChannels({
      ...params,
      channels: { teamA, teamB },
    });
    if (recorded.applied)
      return { snapshot: recorded.snapshot, channels: { teamA, teamB } };
    const cleanupFailures = await deleteCreatedTeamChannels({ teamA: teamB });
    if (cleanupFailures.length > 0)
      throw new Error(
        `Voice channel cleanup failed: ${cleanupFailures.join("; ")}`,
      );
    return recorded;
  } catch (error) {
    const cleanupFailures = await deleteCreatedTeamChannels({ teamA: teamB });
    if (cleanupFailures.length > 0)
      throw new Error(
        `${errorMessage(error)}; Voice channel cleanup failed: ${cleanupFailures.join("; ")}`,
        { cause: error },
      );
    throw error;
  }
}

export async function findCreatedTeamChannels(
  guild: Guild,
  lobby: VoiceChannel,
  gameId: string,
): Promise<{ teamAChannelId: string; teamBChannelId?: string } | null> {
  const channels = await guild.channels.fetch();
  const matches = channels
    .filter(
      (channel) =>
        channel !== null &&
        channel.type === ChannelType.GuildVoice &&
        channel.parentId === lobby.parentId &&
        (channel.name === teamChannelName("A", gameId) ||
          channel.name === teamChannelName("B", gameId)),
    )
    .map((channel) =>
      channel === null ? null : { id: channel.id, name: channel.name },
    );
  const teamA = matches.find(
    (channel) =>
      channel !== null && channel.name === teamChannelName("A", gameId),
  );
  if (teamA === undefined || teamA === null) return null;
  const teamB = matches.find(
    (channel) =>
      channel !== null && channel.name === teamChannelName("B", gameId),
  );
  return teamB === undefined || teamB === null
    ? { teamAChannelId: teamA.id }
    : { teamAChannelId: teamA.id, teamBChannelId: teamB.id };
}
