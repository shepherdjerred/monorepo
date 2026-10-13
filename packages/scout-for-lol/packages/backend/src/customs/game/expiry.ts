import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { syncCustomRecruitmentMessage } from "#src/customs/recruitment-message.ts";
import { publishCustomNightSnapshot } from "#src/customs/socket.ts";
import { cleanExpiredCustomVoice } from "#src/customs/voice-service.ts";
import { createLogger } from "#src/logger.ts";
import { orchestrationMode } from "#src/temporal/orchestration-cutover.ts";
import { commitCustomOperation } from "#src/customs/operations/request.ts";
import { buildCustomNightSnapshot } from "#src/customs/snapshot.ts";
import { expireHeldCustomOperation } from "#src/customs/operations/expiry.ts";

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

export async function expireDurableCustomNights(
  client: ExtendedPrismaClient,
  now: Date,
): Promise<void> {
  const due = await client.customNight.findMany({
    where: {
      state: { not: "ENDED" },
      expiresAt: { lte: now },
      operations: { none: { state: { in: ["queued", "running"] } } },
    },
    include: {
      operations: { where: { state: "held" }, select: { id: true }, take: 1 },
    },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  const failures: unknown[] = [];
  for (const candidate of due)
    try {
      const held = candidate.operations[0];
      if (held !== undefined) {
        await expireHeldCustomOperation(client, held.id, now);
        continue;
      }
      const snapshot = await buildCustomNightSnapshot(
        client,
        candidate.id,
        "temporal:custom-nights-expiry",
        now,
      );
      if (snapshot === undefined)
        throw new Error("Custom night disappeared before expiry");
      await commitCustomOperation(client, snapshot, {
        actorDiscordId: "temporal:custom-nights-expiry",
        action: "expire",
        now,
        input: {
          nightId: candidate.id,
          expectedRevision: snapshot.revision,
          reason: "Custom night expired",
        },
      });
    } catch (error) {
      failures.push(error);
    }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      "Some Customs expiry operations could not be queued",
    );
}

export async function expireCustomNights(now = new Date()): Promise<void> {
  const mode = await orchestrationMode();
  if (mode === "paused") return;
  if (mode === "durable") {
    await expireDurableCustomNights(prisma, now);
    return;
  }
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
