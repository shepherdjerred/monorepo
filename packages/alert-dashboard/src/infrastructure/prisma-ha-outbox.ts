import type { Prisma } from "#generated/prisma/client/index.js";
import type {
  ClaimedHomeAssistantOutboxItem,
  HomeAssistantNotification,
  HomeAssistantSendFailureInput,
  HomeAssistantSendSuccessInput,
} from "#application/ports";
import { houseNotificationId, houseNotificationPayload } from "#domain/alert";
import {
  claimableOutboxRowWhere,
  claimedSendWhere,
  sentOutboxUpdateData,
} from "#infrastructure/prisma-email-claim";
import { OutboxIdSchema } from "#shared/schema";
import { epochNanosecondsToInstantText } from "#shared/time";

export const HA_SEND_CLAIM_LEASE_NS = 5n * 60n * 1_000_000_000n;

export async function enqueueHaNotifyRow(
  transaction: Prisma.TransactionClient,
  input: {
    occurrenceId: string;
    fingerprint: string;
    labels: Readonly<Record<string, string>>;
    annotations: Readonly<Record<string, string>>;
    nowNs: bigint;
  },
): Promise<void> {
  const payload = houseNotificationPayload(input);
  await transaction.homeAssistantOutbox.create({
    data: {
      id: OutboxIdSchema.parse(crypto.randomUUID()),
      occurrenceId: input.occurrenceId,
      action: "notify",
      notificationId: payload.notificationId,
      title: payload.title,
      message: payload.message,
      createdAtNs: input.nowNs,
      nextAttemptAtNs: input.nowNs,
    },
  });
}

/**
 * When a previously HA-notified occurrence resolves, any unsent unclaimed
 * `"notify"` row is canceled so an already-resolved chore never pushes to the
 * phone, and a `"dismiss"` row is enqueued to clear the persistent notification.
 */
export async function resolveHaNotificationRows(
  transaction: Prisma.TransactionClient,
  input: {
    occurrenceId: string;
    fingerprint: string;
    nowNs: bigint;
  },
): Promise<void> {
  const reclaimBeforeNs = input.nowNs - HA_SEND_CLAIM_LEASE_NS;
  await transaction.homeAssistantOutbox.updateMany({
    where: {
      occurrenceId: input.occurrenceId,
      action: "notify",
      sentAtNs: null,
      canceledAtNs: null,
      OR: [{ sendingAtNs: null }, { sendingAtNs: { lte: reclaimBeforeNs } }],
    },
    data: {
      canceledAtNs: input.nowNs,
      sendingAtNs: null,
      sendClaimId: null,
    },
  });
  await transaction.homeAssistantOutbox.create({
    data: {
      id: OutboxIdSchema.parse(crypto.randomUUID()),
      occurrenceId: input.occurrenceId,
      action: "dismiss",
      notificationId: houseNotificationId(input.fingerprint),
      createdAtNs: input.nowNs,
      nextAttemptAtNs: input.nowNs,
    },
  });
}

function toNotification(row: {
  action: string;
  notificationId: string;
  title: string | null;
  message: string | null;
}): HomeAssistantNotification {
  if (row.action === "dismiss") {
    return { action: "dismiss", notificationId: row.notificationId };
  }
  if (row.action === "notify") {
    return {
      action: "notify",
      notificationId: row.notificationId,
      title: row.title ?? "[House] Alert",
      message: row.message ?? row.notificationId,
    };
  }
  throw new Error(`Unknown HomeAssistantOutbox action: ${row.action}`);
}

async function shouldSkipClaimCandidate(
  transaction: Prisma.TransactionClient,
  candidate: {
    id: string;
    occurrenceId: string;
    action: string;
    occurrence: { lifecycleState: string };
  },
  nowNs: bigint,
): Promise<boolean> {
  if (
    candidate.action === "notify" &&
    candidate.occurrence.lifecycleState === "resolved"
  ) {
    await transaction.homeAssistantOutbox.updateMany({
      where: { id: candidate.id, sentAtNs: null, canceledAtNs: null },
      data: { canceledAtNs: nowNs, sendingAtNs: null, sendClaimId: null },
    });
    return true;
  }
  if (candidate.action === "dismiss") {
    const pendingNotifyCount = await transaction.homeAssistantOutbox.count({
      where: {
        occurrenceId: candidate.occurrenceId,
        action: "notify",
        sentAtNs: null,
        canceledAtNs: null,
      },
    });
    return pendingNotifyCount > 0;
  }
  return false;
}

export async function claimPendingHaRows(
  transaction: Prisma.TransactionClient,
  nowNs: bigint,
  limit: number,
  sendingAtNs: bigint,
): Promise<readonly ClaimedHomeAssistantOutboxItem[]> {
  const reclaimBeforeNs = nowNs - HA_SEND_CLAIM_LEASE_NS;
  const candidates = await transaction.homeAssistantOutbox.findMany({
    where: {
      sentAtNs: null,
      canceledAtNs: null,
      nextAttemptAtNs: { lte: nowNs },
      OR: [{ sendingAtNs: null }, { sendingAtNs: { lte: reclaimBeforeNs } }],
    },
    orderBy: [{ nextAttemptAtNs: "asc" }, { createdAtNs: "asc" }],
    take: limit,
    select: {
      id: true,
      occurrenceId: true,
      action: true,
      notificationId: true,
      title: true,
      message: true,
      attemptCount: true,
      occurrence: { select: { lifecycleState: true } },
    },
  });
  const claimed: ClaimedHomeAssistantOutboxItem[] = [];
  for (const candidate of candidates) {
    if (await shouldSkipClaimCandidate(transaction, candidate, nowNs)) {
      continue;
    }
    const sendClaimId = crypto.randomUUID();
    const result = await transaction.homeAssistantOutbox.updateMany({
      where: claimableOutboxRowWhere(candidate.id, nowNs, reclaimBeforeNs),
      data: { sendingAtNs, sendClaimId },
    });
    if (result.count === 1) {
      claimed.push({
        id: candidate.id,
        sendClaimId,
        attemptCount: candidate.attemptCount,
        notification: toNotification(candidate),
      });
    }
  }
  return claimed;
}

export async function markHaSentRow(
  transaction: Prisma.TransactionClient,
  input: HomeAssistantSendSuccessInput,
): Promise<void> {
  const result = await transaction.homeAssistantOutbox.updateMany({
    where: claimedSendWhere(input.id, input.sendClaimId),
    data: sentOutboxUpdateData(input.sentAtNs),
  });
  if (result.count !== 1) {
    throw new Error(
      `Home Assistant send claim changed before success: ${input.id}`,
    );
  }
}

export async function markHaFailedRow(
  transaction: Prisma.TransactionClient,
  input: HomeAssistantSendFailureInput,
): Promise<void> {
  const current = await transaction.homeAssistantOutbox.findUnique({
    where: { id: input.id },
    select: {
      action: true,
      occurrence: { select: { lifecycleState: true } },
    },
  });
  const cancelResolvedNotify =
    current?.action === "notify" &&
    current.occurrence.lifecycleState === "resolved";
  const result = await transaction.homeAssistantOutbox.updateMany({
    where: claimedSendWhere(input.id, input.sendClaimId),
    data: {
      ...(cancelResolvedNotify
        ? { canceledAtNs: input.failedAtNs }
        : { nextAttemptAtNs: input.nextAttemptAtNs }),
      sendingAtNs: null,
      sendClaimId: null,
      attemptCount: { increment: 1 },
      lastError: `${epochNanosecondsToInstantText(input.failedAtNs)} ${input.error}`,
    },
  });
  if (result.count !== 1) {
    throw new Error(
      `Home Assistant send claim changed before failure: ${input.id}`,
    );
  }
}
