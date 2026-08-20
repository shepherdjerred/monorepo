import type { CustomNightSnapshot } from "@scout-for-lol/data";
import { z } from "zod";
import {
  cleanupCustomVoice,
  returnCustomPlayersToLobby,
  type CustomVoiceReturnTarget,
} from "#src/customs/voice-cleanup.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { getCustomNight } from "#src/customs/repository.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("customs-result-voice");
const PendingResultVoicePayloadSchema = z.object({
  target: z.object({
    guildId: z.string(),
    voiceLobbyChannelId: z.string(),
    teamAVoiceChannelId: z.string().nullable(),
    teamBVoiceChannelId: z.string().nullable(),
    currentGame: z
      .object({
        participants: z.array(
          z.object({ discordId: z.string(), displayName: z.string() }),
        ),
      })
      .nullable(),
  }),
});

export function pendingCustomResultVoiceIncludesParticipant(
  payload: string,
  discordId: string,
): boolean {
  const parsed = PendingResultVoicePayloadSchema.parse(JSON.parse(payload));
  return (
    parsed.target.currentGame?.participants.some(
      (participant) => participant.discordId === discordId,
    ) ?? false
  );
}

function resultVoiceTarget(
  snapshot: CustomNightSnapshot,
): CustomVoiceReturnTarget {
  return {
    guildId: snapshot.guildId,
    voiceLobbyChannelId: snapshot.voiceLobbyChannelId,
    teamAVoiceChannelId: snapshot.teamAVoiceChannelId,
    teamBVoiceChannelId: snapshot.teamBVoiceChannelId,
    currentGame:
      snapshot.currentGame === null
        ? null
        : {
            participants: snapshot.currentGame.participants.map(
              (participant) => ({
                discordId: participant.discordId,
                displayName: "Custom player",
              }),
            ),
          },
  };
}

function resultGameId(snapshot: CustomNightSnapshot): string | null {
  return snapshot.currentGame?.id ?? null;
}

export async function recordPendingVoiceReturn(
  prisma: Pick<ExtendedPrismaClient, "customAuditEvent">,
  snapshot: CustomNightSnapshot,
): Promise<void> {
  const gameId = resultGameId(snapshot);
  const existing = await prisma.customAuditEvent.findFirst({
    where: {
      nightId: snapshot.id,
      gameId,
      action: "VOICE_RESULT_RETURN_PENDING",
    },
  });
  if (existing !== null) return;
  await prisma.customAuditEvent.create({
    data: {
      nightId: snapshot.id,
      gameId,
      revision: snapshot.revision,
      actorId: "SCOUT",
      action: "VOICE_RESULT_RETURN_PENDING",
      payload: JSON.stringify({ target: resultVoiceTarget(snapshot) }),
      source: "DISCORD",
    },
  });
}

export async function getPendingCustomResultVoiceTargets(
  prisma: ExtendedPrismaClient,
  nightId: string,
): Promise<CustomVoiceReturnTarget[]> {
  const events = await prisma.customAuditEvent.findMany({
    where: { nightId, action: "VOICE_RESULT_RETURN_PENDING" },
    select: { payload: true },
  });
  return events.map(
    (event) =>
      PendingResultVoicePayloadSchema.parse(JSON.parse(event.payload)).target,
  );
}

export async function cleanupCustomVoiceWithPendingResultTargets(
  prisma: ExtendedPrismaClient,
  snapshot: CustomNightSnapshot,
): Promise<string[]> {
  return await cleanupCustomVoice(
    snapshot,
    await getPendingCustomResultVoiceTargets(prisma, snapshot.id),
  );
}

async function markResultVoiceReturnCompleted(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
}): Promise<void> {
  await params.prisma.customAuditEvent.updateMany({
    where: {
      nightId: params.snapshot.id,
      gameId: resultGameId(params.snapshot),
      action: "VOICE_RESULT_RETURN_PENDING",
    },
    data: {
      action: "VOICE_RESULT_RETURNED",
      payload: JSON.stringify({ completedAt: new Date().toISOString() }),
    },
  });
}

async function attemptResultVoiceReturn(
  snapshot: CustomVoiceReturnTarget,
  nightId: string,
): Promise<string[]> {
  return await returnCustomPlayersToLobby(snapshot, nightId);
}

export async function returnCustomResultPlayersToLobby(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
  nightId: string;
  source: "manual" | "riot";
}): Promise<void> {
  try {
    const failures = await attemptResultVoiceReturn(
      resultVoiceTarget(params.snapshot),
      params.nightId,
    );
    if (failures.length > 0) {
      logger.error("Custom result recorded with voice return failures", {
        failures,
        nightId: params.nightId,
        source: params.source,
      });
      return;
    }
    await markResultVoiceReturnCompleted(params);
  } catch (error) {
    logger.error("Custom result recorded but voice return failed", {
      error,
      nightId: params.nightId,
      source: params.source,
    });
  }
}

export async function retryPendingCustomResultVoice(
  prisma: ExtendedPrismaClient,
): Promise<void> {
  const pending = await prisma.customAuditEvent.findMany({
    where: { action: "VOICE_RESULT_RETURN_PENDING" },
    select: { id: true, nightId: true, gameId: true, payload: true },
  });
  for (const event of pending) {
    try {
      const payload = PendingResultVoicePayloadSchema.parse(
        JSON.parse(event.payload),
      );
      const current = await getCustomNight(prisma, event.nightId);
      let target = payload.target;
      if (current !== null && current.currentGame?.id !== event.gameId) {
        const currentParticipantIds = new Set(
          current.currentGame?.participants.map(
            (participant) => participant.discordId,
          ),
        );
        target = {
          ...target,
          currentGame:
            target.currentGame === null
              ? null
              : {
                  participants: target.currentGame.participants.filter(
                    (participant) =>
                      !currentParticipantIds.has(participant.discordId),
                  ),
                },
        };
      }
      if (
        target.currentGame === null ||
        target.currentGame.participants.length === 0
      ) {
        await prisma.customAuditEvent.update({
          where: { id: event.id },
          data: {
            action: "VOICE_RESULT_RETURN_SUPERSEDED",
            payload: JSON.stringify({ supersededAt: new Date().toISOString() }),
          },
        });
        continue;
      }
      const failures = await attemptResultVoiceReturn(target, event.nightId);
      if (failures.length > 0) {
        logger.error("Pending custom result voice return still has failures", {
          failures,
          nightId: event.nightId,
        });
        continue;
      }
      await prisma.customAuditEvent.update({
        where: { id: event.id },
        data: {
          action: "VOICE_RESULT_RETURNED",
          payload: JSON.stringify({ completedAt: new Date().toISOString() }),
        },
      });
    } catch (error) {
      logger.error("Pending custom result voice return failed", {
        error,
        nightId: event.nightId,
      });
    }
  }
}
