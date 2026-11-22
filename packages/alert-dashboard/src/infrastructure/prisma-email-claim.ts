import type { Prisma } from "#generated/prisma/client/index.js";
import type {
  ClaimedPendingEmail,
  EmailSendFailureInput,
  EmailSendSuccessInput,
} from "#application/ports";
import { epochNanosecondsToInstantText } from "#shared/time";

export const EMAIL_SEND_CLAIM_LEASE_NS = 5n * 60n * 1_000_000_000n;

export function claimableOutboxRowWhere(
  id: string,
  nowNs: bigint,
  reclaimBeforeNs: bigint,
) {
  return {
    id,
    sentAtNs: null,
    canceledAtNs: null,
    nextAttemptAtNs: { lte: nowNs },
    OR: [{ sendingAtNs: null }, { sendingAtNs: { lte: reclaimBeforeNs } }],
  };
}

export function claimedSendWhere(id: string, sendClaimId: string) {
  return {
    id,
    sendClaimId,
    sentAtNs: null,
    canceledAtNs: null,
  };
}

export function sentOutboxUpdateData(sentAtNs: bigint) {
  return {
    sentAtNs,
    sendingAtNs: null,
    sendClaimId: null,
    attemptCount: { increment: 1 },
    lastError: null,
  };
}

export async function claimPendingEmailRows(
  transaction: Prisma.TransactionClient,
  nowNs: bigint,
  limit: number,
  sendingAtNs: bigint,
): Promise<readonly ClaimedPendingEmail[]> {
  const reclaimBeforeNs = nowNs - EMAIL_SEND_CLAIM_LEASE_NS;
  const candidates = await transaction.emailOutbox.findMany({
    where: {
      sentAtNs: null,
      canceledAtNs: null,
      nextAttemptAtNs: { lte: nowNs },
      OR: [{ sendingAtNs: null }, { sendingAtNs: { lte: reclaimBeforeNs } }],
    },
    orderBy: { nextAttemptAtNs: "asc" },
    take: limit,
    select: {
      id: true,
      messageId: true,
      subject: true,
      htmlBody: true,
      plainBody: true,
      attemptCount: true,
    },
  });
  const claimed: ClaimedPendingEmail[] = [];
  for (const candidate of candidates) {
    const sendClaimId = crypto.randomUUID();
    const result = await transaction.emailOutbox.updateMany({
      where: claimableOutboxRowWhere(candidate.id, nowNs, reclaimBeforeNs),
      data: { sendingAtNs, sendClaimId },
    });
    if (result.count === 1) {
      const { plainBody, ...rest } = candidate;
      claimed.push({
        ...rest,
        ...(plainBody === null ? {} : { plainBody }),
        sendClaimId,
      });
    }
  }
  return claimed;
}

export async function markEmailSentRow(
  transaction: Prisma.TransactionClient,
  input: EmailSendSuccessInput,
): Promise<void> {
  const result = await transaction.emailOutbox.updateMany({
    where: claimedSendWhere(input.id, input.sendClaimId),
    data: sentOutboxUpdateData(input.sentAtNs),
  });
  if (result.count !== 1) {
    throw new Error(`Email send claim changed before success: ${input.id}`);
  }
}

export async function markEmailFailedRow(
  transaction: Prisma.TransactionClient,
  input: EmailSendFailureInput,
): Promise<void> {
  const result = await transaction.emailOutbox.updateMany({
    where: claimedSendWhere(input.id, input.sendClaimId),
    data: {
      nextAttemptAtNs: input.nextAttemptAtNs,
      sendingAtNs: null,
      sendClaimId: null,
      attemptCount: { increment: 1 },
      lastError: `${epochNanosecondsToInstantText(input.failedAtNs)} ${input.error}`,
    },
  });
  if (result.count !== 1) {
    throw new Error(`Email send claim changed before failure: ${input.id}`);
  }
}
