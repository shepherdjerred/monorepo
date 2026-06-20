import {
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { z } from "zod";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import type { DeliveryFailureKind } from "#src/discord/utils/permissions.ts";
import { subDays } from "date-fns";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Which (if any) owner notification a failed send should trigger. Backed-off
 * escalation: immediate on the first failure of a streak, again 1 week later,
 * again 1 month after that, then silent.
 */
export const PermissionNotifyDecisionSchema = z.enum([
  "none",
  "immediate",
  "week",
  "month",
]);
export type PermissionNotifyDecision = z.infer<
  typeof PermissionNotifyDecisionSchema
>;

/** The non-silent escalation stages (what an owner notification can be about). */
export type PermissionNotifyStage = Exclude<PermissionNotifyDecision, "none">;

const STAGE_FOR_DECISION: Record<
  Exclude<PermissionNotifyDecision, "none">,
  number
> = {
  immediate: 1,
  week: 2,
  month: 3,
};

/**
 * Decide which escalation notification (if any) is due for the current state.
 * Anchored on `notificationStage` + `lastNotifiedAt` (NOT `firstOccurrence`) so
 * that pre-existing mid-streak rows (which migrate in at stage 0) restart at
 * "immediate" rather than jumping straight to "month".
 */
function computeNotifyDecision(
  existing: { notificationStage: number; lastNotifiedAt: Date | null } | null,
  now: Date,
): PermissionNotifyDecision {
  // Brand-new row, or a streak that hasn't notified yet (incl. legacy rows).
  if (!existing || existing.notificationStage === 0) {
    return "immediate";
  }
  const sinceLast =
    existing.lastNotifiedAt === null
      ? Infinity
      : now.getTime() - existing.lastNotifiedAt.getTime();
  if (existing.notificationStage === 1 && sinceLast >= WEEK_MS) {
    return "week";
  }
  if (existing.notificationStage === 2 && sinceLast >= MONTH_MS) {
    return "month";
  }
  return "none";
}

/**
 * Record a permission error for a guild/channel.
 * Updates existing record or creates new one.
 *
 * @returns the escalation notification (if any) the caller should send to the
 *   owner now: `"immediate"` on the first failure of a streak, `"week"` ~1 week
 *   later, `"month"` ~1 month after that, then `"none"` (silent).
 */
export async function recordPermissionError(
  prisma: ExtendedPrismaClient,
  params: {
    serverId: DiscordGuildId;
    channelId: DiscordChannelId;
    errorType: DeliveryFailureKind;
    errorReason?: string;
  },
): Promise<PermissionNotifyDecision> {
  const { serverId, channelId, errorType, errorReason } = params;
  const now = new Date();

  // Try to find existing error record
  const existing = await prisma.guildPermissionError.findUnique({
    where: {
      serverId_channelId: {
        serverId,
        channelId,
      },
    },
  });

  const decision = computeNotifyDecision(existing, now);
  // When we notify, advance the stage and stamp lastNotifiedAt; otherwise leave
  // the escalation state untouched.
  const notifyData =
    decision === "none"
      ? {}
      : {
          notificationStage: STAGE_FOR_DECISION[decision],
          lastNotifiedAt: now,
        };

  await (existing
    ? prisma.guildPermissionError.update({
        where: {
          serverId_channelId: {
            serverId,
            channelId,
          },
        },
        data: {
          lastOccurrence: now,
          consecutiveErrorCount: existing.consecutiveErrorCount + 1,
          errorType,
          errorReason: errorReason ?? existing.errorReason,
          ...notifyData,
        },
      })
    : prisma.guildPermissionError.create({
        data: {
          serverId,
          channelId,
          errorType,
          errorReason: errorReason ?? null,
          firstOccurrence: now,
          lastOccurrence: now,
          consecutiveErrorCount: 1,
          ...notifyData,
        },
      }));

  return decision;
}

/**
 * Record a successful message send - resets error count
 */
export async function recordSuccessfulSend(
  prisma: ExtendedPrismaClient,
  serverId: DiscordGuildId,
  channelId: DiscordChannelId,
): Promise<void> {
  const now = new Date();

  // Check if there's an existing error record
  const existing = await prisma.guildPermissionError.findUnique({
    where: {
      serverId_channelId: {
        serverId,
        channelId,
      },
    },
  });

  await (existing
    ? prisma.guildPermissionError.update({
        where: {
          serverId_channelId: {
            serverId,
            channelId,
          },
        },
        data: {
          consecutiveErrorCount: 0,
          lastSuccessfulSend: now,
          // Streak resolved: a later failure starts a fresh "immediate".
          notificationStage: 0,
          lastNotifiedAt: null,
        },
      })
    : prisma.guildPermissionError.create({
        data: {
          serverId,
          channelId,
          errorType: "none",
          firstOccurrence: now,
          lastOccurrence: now,
          consecutiveErrorCount: 0,
          lastSuccessfulSend: now,
        },
      }));
}

/**
 * Clean up old error records (optional maintenance)
 * Removes records that have been successfully resolved for more than 30 days
 */
export async function cleanupOldErrorRecords(
  prisma: ExtendedPrismaClient,
): Promise<number> {
  const cutoffDate = subDays(new Date(), 30);

  const result = await prisma.guildPermissionError.deleteMany({
    where: {
      consecutiveErrorCount: 0,
      lastSuccessfulSend: {
        lte: cutoffDate,
      },
    },
  });

  return result.count;
}
