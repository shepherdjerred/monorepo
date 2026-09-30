import {
  DiscordGuildIdSchema,
  MatchIdSchema,
  type DiscordGuildId,
  type MatchId,
} from "@scout-for-lol/data";
import { z } from "zod";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { listIntentsForMatch } from "#src/database/durable/intent-repository.ts";
import {
  isMissingChannelError,
  isPermissionError,
} from "#src/discord/utils/permissions.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { createLogger } from "#src/logger.ts";
import { refreshMvpTallyMessages } from "#src/mvp-votes/message-refresh.ts";

const logger = createLogger("mvp-tally-reconciliation");
// Discord REST retries can outlive one sweep tick. Keep the claim well beyond
// the normal edit budget so a second worker does not race a slow first edit.
const LEASE_MS = 10 * 60_000;
const DiscordErrorCodeSchema = z.object({ code: z.number() });

type RefreshKey = { matchId: MatchId; serverId: DiscordGuildId };

async function hasTerminalNoReportOutcome(
  matchId: MatchId,
  prismaClient: ExtendedPrismaClient,
): Promise<boolean> {
  const found = await listIntentsForMatch(prismaClient, {
    matchId: RiotMatchIdSchema.parse(matchId),
  });
  const intents = found.filter((record) => record.intent.kind === "postmatch");
  // Absence of an intent is not evidence that delivery is finished. Every
  // postmatch intent must have a recorded terminal no-send state.
  return (
    intents.length > 0 &&
    intents.every((record) => {
      const state = record.intent.state.kind;
      return (
        state === "expired" ||
        state === "suppressed" ||
        state === "permission-denied"
      );
    })
  );
}

function editErrorCode(error: unknown): string {
  if (isMissingChannelError(error) || isPermissionError(error)) {
    return "discord-target-unavailable";
  }
  const parsed = DiscordErrorCodeSchema.safeParse(error);
  if (parsed.success && parsed.data.code === 10_008) {
    return "discord-target-unavailable";
  }
  // A timeout or broken connection may happen after Discord accepted the edit.
  // The next attempt replaces the same embed, so the unknown outcome is safe.
  return "discord-edit-unknown";
}

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
      lastErrorCode: "discord-edit-unknown",
    },
  });
  if (claimed.count === 0) return;

  const request = await prismaClient.matchMvpTallyRefresh.findUniqueOrThrow({
    where: { matchId_serverId: { matchId, serverId } },
  });
  const key = { matchId, serverId, leaseToken: token };
  const claimVersion = {
    ...key,
    desiredRevision: request.desiredRevision,
    requeueGeneration: request.requeueGeneration,
  };
  try {
    const updated = await refreshMessages(
      {
        matchId,
        serverId,
        desiredRevision: request.desiredRevision,
        requeueGeneration: request.requeueGeneration,
        leaseToken: token,
      },
      prismaClient,
    );
    if (!updated) {
      const terminal = await hasTerminalNoReportOutcome(matchId, prismaClient);
      const resolved = await prismaClient.matchMvpTallyRefresh.updateMany({
        where: claimVersion,
        data: {
          pending: !terminal,
          leaseToken: null,
          leaseUntil: null,
          lastErrorCode: terminal ? "report-unavailable" : "awaiting-report",
          nextAttemptAt: new Date(now.getTime() + 60_000),
        },
      });
      await prismaClient.matchMvpTallyRefresh.updateMany({
        where: key,
        data: { leaseToken: null, leaseUntil: null },
      });
      if (terminal && resolved.count > 0) {
        logger.warn(
          `MVP tally report unavailable for ${matchId} in ${serverId}`,
        );
      }
      return;
    }
    const completed = await prismaClient.matchMvpTallyRefresh.updateMany({
      where: claimVersion,
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
      const retained = await prismaClient.matchMvpTallyRefresh.updateMany({
        where: key,
        data: {
          appliedRevision: request.desiredRevision,
          leaseToken: null,
          leaseUntil: null,
        },
      });
      if (retained.count === 0) {
        // Another worker claimed the row while this Discord edit was in flight.
        // Its newer edit may already have finished, so make the current revision
        // pending again without changing the other worker's lease. This fences
        // a late stale edit by ensuring a subsequent sweep republishes the tally.
        await prismaClient.matchMvpTallyRefresh.updateMany({
          where: { matchId, serverId },
          data: {
            pending: true,
            nextAttemptAt: new Date(),
            requeueGeneration: { increment: 1 },
            targetProgress: {},
          },
        });
      }
    }
  } catch (error) {
    const delayMs = Math.min(
      15_000 * 2 ** Math.min(request.attemptCount, 6),
      300_000,
    );
    const failed = await prismaClient.matchMvpTallyRefresh.updateMany({
      where: key,
      data: {
        leaseToken: null,
        leaseUntil: null,
        lastErrorCode: editErrorCode(error),
        nextAttemptAt: new Date(Date.now() + delayMs),
      },
    });
    if (failed.count === 0) {
      // A multi-message refresh may have edited some targets before failing.
      // Reconcile once more if another worker finished after this claim lapsed.
      await prismaClient.matchMvpTallyRefresh.updateMany({
        where: { matchId, serverId },
        data: {
          pending: true,
          nextAttemptAt: new Date(),
          requeueGeneration: { increment: 1 },
          targetProgress: {},
        },
      });
    }
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
