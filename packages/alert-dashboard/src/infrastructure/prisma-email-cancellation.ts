import { z } from "zod";

import type { Prisma } from "#generated/prisma/client/index.js";
import { AlertOccurrenceIdSchema } from "#shared/schema";
import { EMAIL_SEND_CLAIM_LEASE_NS } from "#infrastructure/prisma-email-claim";

const OccurrenceIdsSchema = z.array(AlertOccurrenceIdSchema);

export type CancelPendingEmailsInput = {
  alertname: string;
  fromNs: bigint;
  toNs: bigint;
  canceledAtNs: bigint;
  canceledBy: string;
  reason: string;
  confirm: boolean;
};

export type CancelPendingEmailsResult = {
  matched: number;
  canceled: number;
  ids: readonly string[];
};

export async function cancelPendingEmails(
  transaction: Prisma.TransactionClient,
  input: CancelPendingEmailsInput,
): Promise<CancelPendingEmailsResult> {
  const expiredClaimBeforeNs = input.canceledAtNs - EMAIL_SEND_CLAIM_LEASE_NS;
  const pending = await transaction.emailOutbox.findMany({
    where: {
      sentAtNs: null,
      canceledAtNs: null,
      createdAtNs: { gte: input.fromNs, lte: input.toNs },
      OR: [
        { sendingAtNs: null },
        { sendingAtNs: { lte: expiredClaimBeforeNs } },
      ],
    },
    select: { id: true, occurrenceIds: true },
    orderBy: { createdAtNs: "asc" },
  });
  const occurrenceIdsByOutbox = pending
    .map((message) => ({
      id: message.id,
      occurrenceIds: OccurrenceIdsSchema.parse(message.occurrenceIds),
    }))
    .filter((message) => message.occurrenceIds.length > 0);
  const occurrenceIds = [
    ...new Set(
      occurrenceIdsByOutbox.flatMap((message) => message.occurrenceIds),
    ),
  ];
  const occurrences = await transaction.alertOccurrence.findMany({
    where: { id: { in: occurrenceIds } },
    select: { id: true, alertname: true },
  });
  const alertnameByOccurrenceId = new Map(
    occurrences.map((occurrence) => [occurrence.id, occurrence.alertname]),
  );
  const ids = occurrenceIdsByOutbox
    .filter((message) =>
      message.occurrenceIds.every(
        (id) => alertnameByOccurrenceId.get(id) === input.alertname,
      ),
    )
    .map((message) => message.id);

  if (!input.confirm) return { matched: ids.length, canceled: 0, ids };

  let canceled = 0;
  for (const id of ids) {
    const result = await transaction.emailOutbox.updateMany({
      where: {
        id,
        sentAtNs: null,
        canceledAtNs: null,
        createdAtNs: { gte: input.fromNs, lte: input.toNs },
        OR: [
          { sendingAtNs: null },
          { sendingAtNs: { lte: expiredClaimBeforeNs } },
        ],
      },
      data: {
        canceledAtNs: input.canceledAtNs,
        canceledBy: input.canceledBy,
        cancellationReason: input.reason,
        sendClaimId: null,
      },
    });
    if (result.count !== 1) {
      throw new Error(`Pending email changed during cancellation: ${id}`);
    }
    canceled += result.count;
  }
  return { matched: ids.length, canceled, ids };
}
