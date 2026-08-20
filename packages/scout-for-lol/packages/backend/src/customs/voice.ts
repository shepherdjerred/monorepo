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
import {
  hasActiveVoiceArrangementProvisioning,
  refreshSnapshot,
} from "#src/customs/snapshot.ts";
import {
  errorMessage,
  runCustomVoiceOperation,
} from "#src/customs/voice-utils.ts";
import {
  cleanupCustomVoice as cleanupCustomVoiceOperation,
  returnCustomPlayersToLobby as returnCustomPlayersToLobbyOperation,
} from "#src/customs/voice-cleanup.ts";

type TeamChannels = {
  teamA: VoiceChannel;
  teamB: VoiceChannel;
};

type CreatedTeamChannels = {
  teamA: VoiceChannel;
  teamB?: VoiceChannel;
};

class PartialTeamChannelsError extends Error {
  constructor(
    readonly teamA: VoiceChannel,
    message: string,
  ) {
    super(message);
    this.name = "PartialTeamChannelsError";
  }
}

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

async function createTeamChannels(
  guild: Guild,
  lobby: VoiceChannel,
): Promise<TeamChannels> {
  const permissionOverwrites = lobby.permissionOverwrites.cache.map(
    (overwrite) => ({
      id: overwrite.id,
      allow: overwrite.allow.bitfield,
      deny: overwrite.deny.bitfield,
    }),
  );
  const teamA = await guild.channels.create({
    name: "Customs • Team A",
    type: ChannelType.GuildVoice,
    parent: lobby.parentId,
    permissionOverwrites,
    reason: "Scout Customs team voice",
  });
  try {
    const teamB = await guild.channels.create({
      name: "Customs • Team B",
      type: ChannelType.GuildVoice,
      parent: lobby.parentId,
      permissionOverwrites,
      reason: "Scout Customs team voice",
    });
    return { teamA, teamB };
  } catch (error) {
    throw new PartialTeamChannelsError(
      teamA,
      `Team B voice channel creation failed: ${errorMessage(error)}`,
    );
  }
}

async function deleteCreatedTeamChannels(
  channels: CreatedTeamChannels,
): Promise<string[]> {
  const failures: string[] = [];
  for (const channel of [channels.teamA, channels.teamB].flatMap((candidate) =>
    candidate === undefined ? [] : [candidate],
  )) {
    try {
      await channel.delete("Scout Customs voice arrangement did not commit");
    } catch (error) {
      failures.push(`channel ${channel.id}: ${errorMessage(error)}`);
    }
  }
  return failures;
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

async function claimVoiceArrangement(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
  actorDiscordId: string;
  now: Date;
}): Promise<CustomMutationResult & { claimId?: string }> {
  const game = currentGame(params.snapshot);
  if (hasActiveVoiceArrangementProvisioning(game, params.now)) {
    return { applied: false, snapshot: params.snapshot };
  }
  const claimId = globalThis.crypto.randomUUID();
  const previousClaimId = game.voiceArrangementProvisioning?.id ?? null;
  const result = await commitCustomMutation({
    prisma: params.prisma,
    nightId: params.snapshot.id,
    expectedRevision: params.snapshot.revision,
    actorDiscordId: params.actorDiscordId,
    action: "VOICE_ARRANGEMENT_STARTED",
    payload: { claimId, previousClaimId },
    update: (current) => {
      const currentCustomGame = currentGame(current);
      if (currentCustomGame.id !== game.id)
        throw new Error("Custom game changed during voice arrangement");
      return CustomNightSnapshotSchema.parse({
        ...current,
        currentGame: {
          ...currentCustomGame,
          voiceArrangementProvisioning: {
            id: claimId,
            startedAt: params.now.toISOString(),
          },
        },
      });
    },
  });
  return result.applied ? { ...result, claimId } : result;
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

async function moveDraftedPlayers(params: {
  guild: Guild;
  snapshot: CustomNightSnapshot;
  teamA: VoiceChannel;
  teamB: VoiceChannel;
}): Promise<string[]> {
  const game = params.snapshot.currentGame;
  if (game === null) throw new Error("There is no current custom game");
  const allowedSourceIds = new Set([
    params.snapshot.voiceLobbyChannelId,
    params.teamA.id,
    params.teamB.id,
  ]);
  const failures: string[] = [];
  for (const participant of game.participants) {
    if (participant.team === null)
      throw new Error("Cannot arrange voice before teams are complete");
    try {
      const member = await params.guild.members.fetch(participant.discordId);
      if (
        member.voice.channelId !== null &&
        allowedSourceIds.has(member.voice.channelId)
      ) {
        await member.voice.setChannel(
          participant.team === "A" ? params.teamA : params.teamB,
          "Scout Customs team assignment",
        );
      }
    } catch (error) {
      failures.push(`${participant.displayName}: ${errorMessage(error)}`);
    }
  }
  return failures;
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
    const teamAChannelId = latest.teamAVoiceChannelId;
    const teamBChannelId = latest.teamBVoiceChannelId;
    if ((teamAChannelId === null) !== (teamBChannelId === null)) {
      throw new Error("Custom night has only one recorded team voice channel");
    }
    let channels: TeamChannels;
    if (teamAChannelId !== null && teamBChannelId !== null) {
      try {
        channels = {
          teamA: await requireVoiceChannel(guild, teamAChannelId),
          teamB: await requireVoiceChannel(guild, teamBChannelId),
        };
        channelsRecorded = true;
      } catch {
        const cleared = await commitClaimedVoiceArrangement({
          prisma: params.prisma,
          snapshot: latest,
          gameId: game.id,
          claimId: claim.claimId,
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
        latest = cleared.snapshot;
        const replacement = await createAndRecordTeamChannels({
          prisma: params.prisma,
          snapshot: latest,
          gameId: game.id,
          claimId: claim.claimId,
          actorDiscordId: params.actorDiscordId,
          guild,
          lobby,
        });
        if (!("channels" in replacement)) return replacement;
        channels = replacement.channels;
        createdChannels = channels;
        latest = replacement.snapshot;
        channelsRecorded = true;
      }
    } else {
      const created = await createAndRecordTeamChannels({
        prisma: params.prisma,
        snapshot: latest,
        gameId: game.id,
        claimId: claim.claimId,
        actorDiscordId: params.actorDiscordId,
        guild,
        lobby,
      });
      if (!("channels" in created)) return created;
      channels = created.channels;
      createdChannels = channels;
      latest = created.snapshot;
      channelsRecorded = true;
    }
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
