import {
  CustomNightSnapshotSchema,
  type CustomNightSnapshot,
} from "@scout-for-lol/data";
import { z } from "zod";
import { returnCustomPlayersToLobby } from "#src/customs/voice-cleanup.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("customs-result-voice");
const PendingResultVoicePayloadSchema = z.object({
  snapshot: CustomNightSnapshotSchema,
});

function resultGameId(snapshot: CustomNightSnapshot): string | null {
  return snapshot.currentGame?.id ?? null;
}

async function recordPendingResultVoiceReturn(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
}): Promise<void> {
  const gameId = resultGameId(params.snapshot);
  const existing = await params.prisma.customAuditEvent.findFirst({
    where: {
      nightId: params.snapshot.id,
      gameId,
      action: "VOICE_RESULT_RETURN_PENDING",
    },
  });
  if (existing !== null) return;
  await params.prisma.customAuditEvent.create({
    data: {
      nightId: params.snapshot.id,
      gameId,
      revision: params.snapshot.revision,
      actorId: "SCOUT",
      action: "VOICE_RESULT_RETURN_PENDING",
      payload: JSON.stringify({ snapshot: params.snapshot }),
      source: "DISCORD",
    },
  });
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
  snapshot: CustomNightSnapshot,
): Promise<string[]> {
  return await returnCustomPlayersToLobby(snapshot);
}

export async function returnCustomResultPlayersToLobby(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
  nightId: string;
  source: "manual" | "riot";
}): Promise<void> {
  try {
    const failures = await attemptResultVoiceReturn(params.snapshot);
    if (failures.length > 0) {
      logger.error("Custom result recorded with voice return failures", {
        failures,
        nightId: params.nightId,
        source: params.source,
      });
      await recordPendingResultVoiceReturn(params);
      return;
    }
    await markResultVoiceReturnCompleted(params);
  } catch (error) {
    logger.error("Custom result recorded but voice return failed", {
      error,
      nightId: params.nightId,
      source: params.source,
    });
    await recordPendingResultVoiceReturn(params);
  }
}

export async function retryPendingCustomResultVoice(
  prisma: ExtendedPrismaClient,
): Promise<void> {
  const pending = await prisma.customAuditEvent.findMany({
    where: { action: "VOICE_RESULT_RETURN_PENDING" },
    select: { id: true, nightId: true, payload: true },
  });
  for (const event of pending) {
    try {
      const payload = PendingResultVoicePayloadSchema.parse(
        JSON.parse(event.payload),
      );
      const failures = await attemptResultVoiceReturn(payload.snapshot);
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
