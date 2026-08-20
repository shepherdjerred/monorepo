import {
  CustomNightSnapshotSchema,
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

export async function claimVoiceArrangement(params: {
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
