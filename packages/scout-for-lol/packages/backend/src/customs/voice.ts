import { ChannelType, type Guild, type VoiceChannel } from "discord.js";
import {
  CustomNightSnapshotSchema,
  type CustomGameSnapshot,
  type CustomNightSnapshot,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { customsDiscordClient } from "#src/customs/discord-client.ts";
import {
  commitCustomMutation,
  getCustomNight,
  type CustomMutationResult,
} from "#src/customs/repository.ts";
import { refreshSnapshot } from "#src/customs/snapshot.ts";
import {
  errorMessage,
  runCustomVoiceOperation,
} from "#src/customs/voice-utils.ts";
import {
  cleanupCustomVoice as cleanupCustomVoiceOperation,
  returnCustomPlayersToLobby as returnCustomPlayersToLobbyOperation,
} from "#src/customs/voice-cleanup.ts";
import {
  deleteCreatedTeamChannels,
  deleteRecordedTeamChannels,
  moveDraftedPlayers,
  PartialTeamChannelsError,
} from "#src/customs/voice-arrangement-utils.ts";
import { claimVoiceArrangement } from "#src/customs/voice-claim.ts";
import { isMissingChannelError } from "#src/discord/utils/permissions.ts";
type TeamChannels = {
  teamA: VoiceChannel;
  teamB: VoiceChannel;
};

type CreatedTeamChannels = {
  teamA: VoiceChannel;
  teamB?: VoiceChannel;
};

function currentGame(snapshot: CustomNightSnapshot): CustomGameSnapshot {
  if (snapshot.currentGame === null)
    throw new Error("There is no current custom game");
  return snapshot.currentGame;
}

async function requireVoiceChannel(
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

async function createTeamChannel(
  guild: Guild,
  lobby: VoiceChannel,
  name: string,
): Promise<VoiceChannel> {
  return await guild.channels.create(teamChannelOptions(lobby, name));
}

async function createTeamChannels(
  guild: Guild,
  lobby: VoiceChannel,
): Promise<TeamChannels> {
  const teamA = await createTeamChannel(guild, lobby, "Customs • Team A");
  try {
    const teamB = await createTeamChannel(guild, lobby, "Customs • Team B");
    return { teamA, teamB };
  } catch (error) {
    throw new PartialTeamChannelsError(
      teamA,
      `Team B voice channel creation failed: ${errorMessage(error)}`,
    );
  }
}

async function createAndRecordTeamChannels(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
  gameId: string;
  claimId: string;
  actorDiscordId: string;
  guild: Guild;
  lobby: VoiceChannel;
}): Promise<
  | CustomMutationResult
  | { snapshot: CustomNightSnapshot; channels: TeamChannels }
> {
  const channels = await createTeamChannels(params.guild, params.lobby);
  const recorded = await recordCreatedTeamChannels({
    prisma: params.prisma,
    snapshot: params.snapshot,
    gameId: params.gameId,
    claimId: params.claimId,
    actorDiscordId: params.actorDiscordId,
    channels,
  });
  if (!recorded.applied) {
    const cleanupFailures = await deleteCreatedTeamChannels(channels);
    if (cleanupFailures.length > 0)
      throw new Error(
        `Voice channel cleanup failed: ${cleanupFailures.join("; ")}`,
      );
    return recorded;
  }
  return { snapshot: recorded.snapshot, channels };
}

async function recordCreatedTeamChannels(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
  gameId: string;
  claimId: string;
  actorDiscordId: string;
  channels: TeamChannels;
}): Promise<CustomMutationResult> {
  return await recordTeamChannels(params);
}

async function recordTeamChannels(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
  gameId: string;
  claimId: string;
  actorDiscordId: string;
  channels: TeamChannels;
}): Promise<CustomMutationResult> {
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

async function commitClaimedVoiceArrangement(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
  gameId: string;
  claimId: string;
  actorDiscordId: string;
  action: string;
  payload: unknown;
  update: (
    snapshot: CustomNightSnapshot,
    game: CustomGameSnapshot,
  ) => CustomNightSnapshot;
}): Promise<CustomMutationResult> {
  let latest = params.snapshot;
  for (;;) {
    const game = currentGame(latest);
    if (
      game.id !== params.gameId ||
      game.voiceArrangementProvisioning?.id !== params.claimId
    ) {
      return { applied: false, snapshot: latest };
    }
    const result = await commitCustomMutation({
      prisma: params.prisma,
      nightId: latest.id,
      expectedRevision: latest.revision,
      actorDiscordId: params.actorDiscordId,
      action: params.action,
      payload: params.payload,
      update: (current) => {
        const currentCustomGame = currentGame(current);
        if (
          currentCustomGame.id !== params.gameId ||
          currentCustomGame.voiceArrangementProvisioning?.id !== params.claimId
        ) {
          throw new Error("Voice arrangement claim changed");
        }
        return params.update(current, currentCustomGame);
      },
    });
    if (result.applied) return result;
    latest = result.snapshot;
  }
}

async function recoverPartialTeamChannels(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
  gameId: string;
  claimId: string;
  actorDiscordId: string;
  guild: Guild;
  lobby: VoiceChannel;
  teamAChannelId: string;
}): Promise<
  | CustomMutationResult
  | { snapshot: CustomNightSnapshot; channels: TeamChannels }
> {
  const teamA = await requireVoiceChannel(params.guild, params.teamAChannelId);
  const teamB = await createTeamChannel(
    params.guild,
    params.lobby,
    "Customs • Team B",
  );
  const recorded = await recordTeamChannels({
    prisma: params.prisma,
    snapshot: params.snapshot,
    gameId: params.gameId,
    claimId: params.claimId,
    actorDiscordId: params.actorDiscordId,
    channels: { teamA, teamB },
  });
  if (recorded.applied)
    return { snapshot: recorded.snapshot, channels: { teamA, teamB } };
  const cleanupFailures = await deleteCreatedTeamChannels({ teamA: teamB });
  if (cleanupFailures.length > 0) {
    throw new Error(
      `Voice channel cleanup failed: ${cleanupFailures.join("; ")}`,
    );
  }
  return recorded;
}

async function prepareTeamChannels(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
  gameId: string;
  claimId: string;
  actorDiscordId: string;
  guild: Guild;
  lobby: VoiceChannel;
}): Promise<
  | CustomMutationResult
  | {
      snapshot: CustomNightSnapshot;
      channels: TeamChannels;
      createdChannels: CreatedTeamChannels | null;
    }
> {
  const teamAChannelId = params.snapshot.teamAVoiceChannelId;
  const teamBChannelId = params.snapshot.teamBVoiceChannelId;
  if (teamAChannelId !== null && teamBChannelId === null) {
    const recovered = await recoverPartialTeamChannels({
      ...params,
      teamAChannelId,
    });
    if (!("channels" in recovered)) return recovered;
    return {
      snapshot: recovered.snapshot,
      channels: recovered.channels,
      createdChannels: recovered.channels,
    };
  }
  if (teamAChannelId !== null && teamBChannelId !== null) {
    try {
      return {
        snapshot: params.snapshot,
        channels: {
          teamA: await requireVoiceChannel(params.guild, teamAChannelId),
          teamB: await requireVoiceChannel(params.guild, teamBChannelId),
        },
        createdChannels: null,
      };
    } catch (error) {
      if (!isMissingChannelError(error)) throw error;
      await deleteRecordedTeamChannels(params.guild, [
        teamAChannelId,
        teamBChannelId,
      ]);
      const cleared = await commitClaimedVoiceArrangement({
        prisma: params.prisma,
        snapshot: params.snapshot,
        gameId: params.gameId,
        claimId: params.claimId,
        actorDiscordId: params.actorDiscordId,
        action: "VOICE_CHANNELS_MISSING",
        payload: {
          teamAVoiceChannelId: teamAChannelId,
          teamBVoiceChannelId: teamBChannelId,
        },
        update: (current) =>
          CustomNightSnapshotSchema.parse({
            ...current,
            teamAVoiceChannelId: null,
            teamBVoiceChannelId: null,
          }),
      });
      if (!cleared.applied) return cleared;
      const replacement = await createAndRecordTeamChannels({
        prisma: params.prisma,
        snapshot: cleared.snapshot,
        gameId: params.gameId,
        claimId: params.claimId,
        actorDiscordId: params.actorDiscordId,
        guild: params.guild,
        lobby: params.lobby,
      });
      if (!("channels" in replacement)) return replacement;
      return {
        snapshot: replacement.snapshot,
        channels: replacement.channels,
        createdChannels: replacement.channels,
      };
    }
  }
  const created = await createAndRecordTeamChannels({
    prisma: params.prisma,
    snapshot: params.snapshot,
    gameId: params.gameId,
    claimId: params.claimId,
    actorDiscordId: params.actorDiscordId,
    guild: params.guild,
    lobby: params.lobby,
  });
  if (!("channels" in created)) return created;
  return {
    snapshot: created.snapshot,
    channels: created.channels,
    createdChannels: created.channels,
  };
}

async function arrangeCustomVoiceOperation(params: {
  prisma: ExtendedPrismaClient;
  nightId: string;
  actorDiscordId: string;
  expectedRevision: number;
}) {
  const snapshot = await getCustomNight(params.prisma, params.nightId);
  if (snapshot === null) throw new Error("Custom night not found");
  if (snapshot.revision !== params.expectedRevision)
    return { applied: false, snapshot };
  const claim = await claimVoiceArrangement({
    prisma: params.prisma,
    snapshot,
    actorDiscordId: params.actorDiscordId,
    now: new Date(),
  });
  if (!claim.applied || claim.claimId === undefined) return claim;
  const game = currentGame(claim.snapshot);
  let latest = claim.snapshot;
  let createdChannels: CreatedTeamChannels | null = null;
  let channelsRecorded = false;
  try {
    const guild = await customsDiscordClient.guilds.fetch(latest.guildId);
    const lobby = await requireVoiceChannel(guild, latest.voiceLobbyChannelId);
    const prepared = await prepareTeamChannels({
      prisma: params.prisma,
      snapshot: latest,
      gameId: game.id,
      claimId: claim.claimId,
      actorDiscordId: params.actorDiscordId,
      guild,
      lobby,
    });
    if (!("channels" in prepared)) return prepared;
    const channels = prepared.channels;
    createdChannels = prepared.createdChannels;
    latest = prepared.snapshot;
    channelsRecorded = true;
    const failures = await moveDraftedPlayers({
      guild,
      snapshot: latest,
      ...channels,
    });
    return await commitClaimedVoiceArrangement({
      prisma: params.prisma,
      snapshot: latest,
      gameId: game.id,
      claimId: claim.claimId,
      actorDiscordId: params.actorDiscordId,
      action:
        failures.length === 0 ? "VOICE_ARRANGED" : "VOICE_ARRANGEMENT_FAILED",
      payload: {
        teamAVoiceChannelId: channels.teamA.id,
        teamBVoiceChannelId: channels.teamB.id,
        failures,
      },
      update: (current, currentCustomGame) =>
        refreshSnapshot(
          {
            ...current,
            currentGame: {
              ...currentCustomGame,
              voiceArrangementProvisioning: null,
              voiceReady: failures.length === 0,
              voiceError: failures.length === 0 ? null : failures.join("; "),
            },
          },
          new Date(),
        ),
    });
  } catch (error) {
    if (error instanceof PartialTeamChannelsError) {
      const recorded = await commitClaimedVoiceArrangement({
        prisma: params.prisma,
        snapshot: latest,
        gameId: game.id,
        claimId: claim.claimId,
        actorDiscordId: params.actorDiscordId,
        action: "VOICE_CHANNEL_CREATED",
        payload: {
          teamAVoiceChannelId: error.teamA.id,
          teamBVoiceChannelId: null,
        },
        update: (current) =>
          CustomNightSnapshotSchema.parse({
            ...current,
            teamAVoiceChannelId: error.teamA.id,
            teamBVoiceChannelId: null,
          }),
      });
      if (recorded.applied) {
        latest = recorded.snapshot;
        channelsRecorded = true;
      }
    }
    const cleanupFailures =
      createdChannels === null || channelsRecorded
        ? []
        : await deleteCreatedTeamChannels(createdChannels);
    const message = [errorMessage(error), ...cleanupFailures].join("; ");
    const failed = await commitClaimedVoiceArrangement({
      prisma: params.prisma,
      snapshot: latest,
      gameId: game.id,
      claimId: claim.claimId,
      actorDiscordId: params.actorDiscordId,
      action: "VOICE_ARRANGEMENT_FAILED",
      payload: { failures: [message] },
      update: (current, currentCustomGame) =>
        refreshSnapshot(
          {
            ...current,
            currentGame: {
              ...currentCustomGame,
              voiceArrangementProvisioning: null,
              voiceReady: false,
              voiceError: message,
            },
          },
          new Date(),
        ),
    });
    if (failed.applied) return failed;
    throw error;
  }
}

export async function arrangeCustomVoice(
  params: Parameters<typeof arrangeCustomVoiceOperation>[0],
) {
  return await runCustomVoiceOperation(
    params.nightId,
    async () => await arrangeCustomVoiceOperation(params),
  );
}

export async function cleanupCustomVoice(
  snapshot: CustomNightSnapshot,
): Promise<string[]> {
  return await cleanupCustomVoiceOperation(snapshot);
}

export async function returnCustomPlayersToLobby(
  snapshot: CustomNightSnapshot,
): Promise<string[]> {
  return await returnCustomPlayersToLobbyOperation(snapshot);
}
