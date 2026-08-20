import {
  CustomNightSnapshotSchema,
  type CustomGameSnapshot,
  type CustomNightSnapshot,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  commitCustomMutation,
  type CustomMutationResult,
} from "#src/customs/repository.ts";
import { hasActiveVoiceArrangementProvisioning } from "#src/customs/snapshot.ts";

function currentGame(snapshot: CustomNightSnapshot) {
  if (snapshot.currentGame === null)
    throw new Error("There is no current custom game");
  return snapshot.currentGame;
}

export async function commitClaimedVoiceArrangement(params: {
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

export async function clearClaimedTeamChannels(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
  gameId: string;
  claimId: string;
  actorDiscordId: string;
  teamAVoiceChannelId: string;
  teamBVoiceChannelId: string | null;
}): Promise<CustomMutationResult> {
  return await commitClaimedVoiceArrangement({
    ...params,
    action: "VOICE_CHANNELS_MISSING",
    payload: {
      teamAVoiceChannelId: params.teamAVoiceChannelId,
      teamBVoiceChannelId: params.teamBVoiceChannelId,
    },
    update: (current) =>
      CustomNightSnapshotSchema.parse({
        ...current,
        teamAVoiceChannelId: null,
        teamBVoiceChannelId: null,
      }),
  });
}

export async function claimVoiceArrangement(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
  actorDiscordId: string;
  now: Date;
}): Promise<CustomMutationResult & { claimId?: string }> {
  const game = currentGame(params.snapshot);
  if (game.state !== "CODE_PENDING" && game.state !== "LOBBY_READY") {
    throw new Error(
      "Voice arrangement is only available before the custom game starts",
    );
  }
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
