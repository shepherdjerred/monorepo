import {
  DiscordGuildIdSchema,
  MatchIdSchema,
  type DiscordGuildId,
  type MatchId,
} from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { refreshMvpTallyMessages } from "#src/mvp-votes/message-refresh.ts";

const logger = createLogger("mvp-tally-reconciliation");
// Discord REST retries can outlive one sweep tick. Keep the claim well beyond
// the normal edit budget so a second worker does not race a slow first edit.
const LEASE_MS = 10 * 60_000;
const REPORT_WAIT_MS = 24 * 60 * 60_000;

type RefreshKey = { matchId: MatchId; serverId: DiscordGuildId };

/** Claim one coalesced request across gateway and background worker replicas. */
export async function reconcileMvpTallyRefresh(
  input: RefreshKey,
  prismaClient: ExtendedPrismaClient = prisma,
  refreshMessages: typeof refreshMvpTallyMessages = refreshMvpTallyMessages,
): Promise<void> {
  const matchId = MatchIdSchema.parse(input.matchId);
  const serverId = DiscordGuildIdSchema.parse(input.serverId);
  const now = new Date();
  const token = crypto.randomUUID();
  const claimed = await prismaClient.matchMvpTallyRefresh.updateMany({
    where: {
      matchId,
      serverId,
      pending: true,
      nextAttemptAt: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
    },
    data: {
      leaseToken: token,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      attemptCount: { increment: 1 },
      lastAttemptAt: now,
    },
  });
  if (claimed.count === 0) return;

  const request = await prismaClient.matchMvpTallyRefresh.findUniqueOrThrow({
    where: { matchId_serverId: { matchId, serverId } },
  });
  const key = { matchId, serverId, leaseToken: token };
  try {
    const updated = await refreshMessages({ matchId, serverId }, prismaClient);
    if (!updated) {
      const terminal =
        now.getTime() - request.requestedAt.getTime() >= REPORT_WAIT_MS;
      await prismaClient.matchMvpTallyRefresh.updateMany({
        where: { ...key, desiredRevision: request.desiredRevision },
        data: {
          pending: !terminal,
          leaseToken: null,
          leaseUntil: null,
          lastErrorCode: terminal ? "report-unavailable" : "awaiting-report",
          nextAttemptAt: new Date(now.getTime() + 60_000),
        },
      });
      await prismaClient.matchMvpTallyRefresh.updateMany({
        where: { ...key, desiredRevision: { not: request.desiredRevision } },
        data: { leaseToken: null, leaseUntil: null },
      });
      if (terminal) {
        logger.warn(
          `MVP tally report unavailable for ${matchId} in ${serverId}`,
        );
      }
      return;
    }
    const completed = await prismaClient.matchMvpTallyRefresh.updateMany({
      where: { ...key, desiredRevision: request.desiredRevision },
      data: {
        appliedRevision: request.desiredRevision,
        pending: false,
        leaseToken: null,
        leaseUntil: null,
        lastErrorCode: null,
      },
    });
    if (completed.count === 0) {
      // A vote committed during the edit. Preserve its pending request.
      await prismaClient.matchMvpTallyRefresh.updateMany({
        where: key,
        data: {
          appliedRevision: request.desiredRevision,
          leaseToken: null,
          leaseUntil: null,
        },
      });
    }
  } catch (error) {
    const delayMs = Math.min(
      15_000 * 2 ** Math.min(request.attemptCount, 6),
      300_000,
    );
    await prismaClient.matchMvpTallyRefresh.updateMany({
      where: key,
      data: {
        leaseToken: null,
        leaseUntil: null,
        lastErrorCode: "discord-edit-failed",
        nextAttemptAt: new Date(Date.now() + delayMs),
      },
    });
    logger.warn(
      `MVP tally edit will retry for ${matchId} in ${serverId}`,
      error,
    );
  }
}

/** A short, bounded Temporal sweep also recovers requests after a gateway crash. */
export async function reconcilePendingMvpTallyRefreshes(
  prismaClient: ExtendedPrismaClient = prisma,
  refreshMessages: typeof refreshMvpTallyMessages = refreshMvpTallyMessages,
): Promise<void> {
  const now = new Date();
  const requests = await prismaClient.matchMvpTallyRefresh.findMany({
    where: {
      pending: true,
      nextAttemptAt: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: 100,
    select: { matchId: true, serverId: true },
  });
  for (const request of requests) {
    await reconcileMvpTallyRefresh(
      {
        matchId: MatchIdSchema.parse(request.matchId),
        serverId: DiscordGuildIdSchema.parse(request.serverId),
      },
      prismaClient,
      refreshMessages,
    );
  }
}
