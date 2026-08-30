import type { Prisma } from "#generated/prisma/client/index.js";
import type { PendingEmail } from "#application/ports";

export async function claimPendingEmailRows(
  transaction: Prisma.TransactionClient,
  nowNs: bigint,
  limit: number,
  sendingAtNs: bigint,
): Promise<readonly PendingEmail[]> {
  const candidates = await transaction.emailOutbox.findMany({
    where: {
      sentAtNs: null,
      sendingAtNs: null,
      canceledAtNs: null,
      nextAttemptAtNs: { lte: nowNs },
    },
    orderBy: { nextAttemptAtNs: "asc" },
    take: limit,
    select: {
      id: true,
      messageId: true,
      subject: true,
      htmlBody: true,
      attemptCount: true,
    },
  });
  const claimed: PendingEmail[] = [];
  for (const candidate of candidates) {
    const result = await transaction.emailOutbox.updateMany({
      where: {
        id: candidate.id,
        sentAtNs: null,
        sendingAtNs: null,
        canceledAtNs: null,
        nextAttemptAtNs: { lte: nowNs },
      },
      data: { sendingAtNs },
    });
    if (result.count === 1) claimed.push(candidate);
  }
  return claimed;
}
