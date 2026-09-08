import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { syncCustomRecruitmentMessage } from "#src/customs/recruitment-message.ts";
import { publishCustomNightSnapshot } from "#src/customs/socket.ts";
import { cleanExpiredCustomVoice } from "#src/customs/voice-service.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("customs-expiry");

export async function expireCustomNightsInDatabase(
  client: ExtendedPrismaClient,
  now: Date,
  beforeExpire?: (nightId: string) => Promise<void>,
): Promise<readonly string[]> {
  const candidates = await client.customNight.findMany({
    where: { state: { not: "ENDED" }, expiresAt: { lte: now } },
    select: {
      id: true,
      revision: true,
      teamAVoiceChannelId: true,
      teamBVoiceChannelId: true,
    },
    orderBy: { expiresAt: "asc" },
  });
  const expiredNightIds: string[] = [];
  for (const candidate of candidates) {
    if (
      candidate.teamAVoiceChannelId !== null ||
      candidate.teamBVoiceChannelId !== null
    ) {
      if (beforeExpire === undefined) {
        throw new Error(
          `Custom night ${candidate.id} requires voice cleanup before expiry`,
        );
      }
      await beforeExpire(candidate.id);
    }
    const expired = await client.$transaction(async (transaction) => {
      const revision = candidate.revision + 1;
      const updated = await transaction.customNight.updateMany({
        where: {
          id: candidate.id,
          revision: candidate.revision,
          state: { not: "ENDED" },
          expiresAt: { lte: now },
        },
        data: {
          state: "ENDED",
          revision,
          endedAt: now,
          lastActivityAt: now,
          teamAVoiceChannelId: null,
          teamBVoiceChannelId: null,
        },
      });
      if (updated.count === 0) return false;
      const game = await transaction.customGame.findFirst({
        where: { nightId: candidate.id },
        orderBy: { sequence: "desc" },
        select: { id: true, state: true },
      });
      if (game !== null && !["VERIFIED", "VOID"].includes(game.state)) {
        await transaction.customGame.update({
          where: { id: game.id },
          data: {
            state: "VOID",
            completedAt: now,
            voiceState: "CLEANED_UP",
            voiceReady: false,
            voiceError: null,
          },
        });
        await transaction.tournamentLobby.updateMany({
          where: {
            customGame: { id: game.id },
            state: { notIn: ["reported", "cancelled", "abandoned", "expired"] },
          },
          data: { state: "cancelled" },
        });
        await transaction.customAuditEvent.create({
          data: {
            nightId: candidate.id,
            gameId: game.id,
            revision,
            actorId: "temporal:custom-nights-expiry",
            action: "GAME_VOIDED",
            payload: JSON.stringify({ reason: "Custom night expired" }),
            source: "TEMPORAL",
          },
        });
      }
      await transaction.customActiveNight.deleteMany({
        where: { nightId: candidate.id },
      });
      await transaction.customAuditEvent.create({
        data: {
          nightId: candidate.id,
          revision,
          actorId: "temporal:custom-nights-expiry",
          action: "NIGHT_EXPIRED",
          payload: JSON.stringify({ expiredAt: now.toISOString() }),
          source: "TEMPORAL",
        },
      });
      return true;
    });
    if (expired) expiredNightIds.push(candidate.id);
  }
  return expiredNightIds;
}

export async function expireCustomNights(now = new Date()): Promise<void> {
  const expiredNightIds = await expireCustomNightsInDatabase(
    prisma,
    now,
    cleanExpiredCustomVoice,
  );
  for (const nightId of expiredNightIds) {
    try {
      await syncCustomRecruitmentMessage(prisma, nightId);
    } catch (error) {
      logger.error("Expired Customs recruitment delivery failed", {
        error,
        nightId,
      });
    }
    await publishCustomNightSnapshot(nightId);
  }
}
