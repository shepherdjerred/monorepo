import { z } from "zod";

import type { Prisma } from "#generated/prisma/client/index.js";
import { AlertOccurrenceIdSchema } from "#shared/schema";
import { EMAIL_SEND_CLAIM_LEASE_NS } from "#infrastructure/prisma-email-claim";

const OccurrenceIdsSchema = z.array(AlertOccurrenceIdSchema);

export type CancelPendingEmailsInput = {
  /**
   * Restrict cancellation to rows whose every occurrence carries this
   * alertname. Omit to cancel every pending row in the window, which is the
   * only way to reach rows that carry no occurrences at all — a truncation
   * notice, or anything queued under a since-pruned occurrence. Those rows are
   * unreachable by any alertname and would otherwise sit pending forever.
   */
  alertname?: string | undefined;
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

/**
 * Rows whose occurrences ALL carry `alertname`. A row with no occurrences is
 * not attributable to any alertname, so it is excluded here rather than
 * silently swept up by a targeted cancellation.
 */
async function attributedToAlertname(
  transaction: Prisma.TransactionClient,
  messages: readonly { id: string; occurrenceIds: readonly string[] }[],
  alertname: string,
): Promise<string[]> {
  const attributed = messages.filter(
    (message) => message.occurrenceIds.length > 0,
  );
  const occurrenceIds = [
    ...new Set(attributed.flatMap((message) => message.occurrenceIds)),
  ];
  const occurrences = await transaction.alertOccurrence.findMany({
    where: { id: { in: occurrenceIds } },
    select: { id: true, alertname: true },
  });
  const alertnameByOccurrenceId = new Map(
    occurrences.map((occurrence) => [occurrence.id, occurrence.alertname]),
  );
  return attributed
    .filter((message) =>
      message.occurrenceIds.every(
        (id) => alertnameByOccurrenceId.get(id) === alertname,
      ),
    )
    .map((message) => message.id);
}

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
  const parsed = pending.map((message) => ({
    id: message.id,
    occurrenceIds: OccurrenceIdsSchema.parse(message.occurrenceIds),
  }));
  const ids =
    input.alertname === undefined
      ? parsed.map((message) => message.id)
      : await attributedToAlertname(transaction, parsed, input.alertname);

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
