import { type Guild, type VoiceChannel } from "discord.js";
import {
  CustomNightSnapshotSchema,
  type CustomGameSnapshot,
  type CustomNightSnapshot,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { customsDiscordClient } from "#src/customs/discord-client.ts";
import {
  getCustomNight,
  type CustomMutationResult,
} from "#src/customs/repository.ts";
import { refreshSnapshot } from "#src/customs/snapshot.ts";
import {
  errorMessage,
  runCustomVoiceOperation,
} from "#src/customs/voice-utils.ts";
import {
  deleteCreatedTeamChannels,
  deleteRecordedTeamChannels,
  moveDraftedPlayers,
  PartialTeamChannelsError,
} from "#src/customs/voice-arrangement-utils.ts";
import {
  claimVoiceArrangement,
  clearClaimedTeamChannels,
  commitClaimedVoiceArrangement,
} from "#src/customs/voice-claim.ts";
import { isMissingChannelError } from "#src/discord/utils/permissions.ts";
import {
  findCreatedTeamChannels,
  createAndRecordTeamChannels,
  recordTeamChannels,
  recoverPartialTeamChannels,
  requireVoiceChannel,
  type CreatedTeamChannels,
  type TeamChannels,
} from "#src/customs/voice-channel-recovery.ts";

function currentGame(snapshot: CustomNightSnapshot): CustomGameSnapshot {
  if (snapshot.currentGame === null)
    throw new Error("There is no current custom game");
  return snapshot.currentGame;
}

async function prepareTeamChannels(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
  gameId: string;
  claimId: string;
  actorDiscordId: string;
  guild: Guild;
  lobby: VoiceChannel;
  recoveryClaimId: string | null;
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
  if (
    teamAChannelId === null &&
    teamBChannelId === null &&
    params.recoveryClaimId !== null
  ) {
    const recovered = await findCreatedTeamChannels(
      params.guild,
      params.lobby,
      params.gameId,
    );
    if (recovered !== null) {
      const teamA = await requireVoiceChannel(
        params.guild,
        recovered.teamAChannelId,
      );
      if (recovered.teamBChannelId === undefined) {
        const partial = await recoverPartialTeamChannels({
          ...params,
          teamAChannelId: teamA.id,
        });
        if (!("channels" in partial)) return partial;
        return {
          snapshot: partial.snapshot,
          channels: partial.channels,
          createdChannels: null,
        };
      }
      const teamB = await requireVoiceChannel(
        params.guild,
        recovered.teamBChannelId,
      );
      const recoveredTeamChannels: TeamChannels = {
        teamA,
        teamB,
      };
      const recorded = await recordTeamChannels({
        prisma: params.prisma,
        snapshot: params.snapshot,
        gameId: params.gameId,
        claimId: params.claimId,
        actorDiscordId: params.actorDiscordId,
        channels: recoveredTeamChannels,
      });
      if (!recorded.applied) return recorded;
      return {
        snapshot: recorded.snapshot,
        channels: recoveredTeamChannels,
        createdChannels: null,
      };
    }
  }
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
      const cleared = await clearClaimedTeamChannels({
        ...params,
        teamAVoiceChannelId: teamAChannelId,
        teamBVoiceChannelId: teamBChannelId,
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
  const previousVoiceClaimId =
    currentGame(snapshot).voiceArrangementProvisioning?.id ?? null;
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
      recoveryClaimId: previousVoiceClaimId ?? claim.claimId,
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
      createdChannels = { teamA: error.teamA };
      let recorded: CustomMutationResult;
      try {
        recorded = await commitClaimedVoiceArrangement({
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
      } catch (recordingError) {
        const cleanupFailures = await deleteCreatedTeamChannels({
          teamA: error.teamA,
        });
        if (cleanupFailures.length > 0)
          throw new Error(
            `${errorMessage(recordingError)}; Voice channel cleanup failed: ${cleanupFailures.join("; ")}`,
            { cause: recordingError },
          );
        throw recordingError;
      }
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
