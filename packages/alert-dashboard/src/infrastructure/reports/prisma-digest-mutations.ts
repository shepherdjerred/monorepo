import { z } from "zod";
import type { Prisma, PrismaClient } from "#generated/prisma/client/index.js";

import type {
  CompletedDailyDigestSummary,
  DigestArchiveFields,
  DigestClaim,
  DigestRunKey,
} from "#application/ports";
import { sentDigestBaseFields } from "#application/reports/report-mappers";
import { DigestStatusSchema } from "#domain/ops-facet-mappers";
import { JsonObjectSchema } from "#shared/schema";

const CompletedDigestStatusSchema = z.enum(["sent", "skipped"]);

export async function claimDigestRunTransaction(
  transaction: Prisma.TransactionClient,
  key: DigestRunKey,
  nowNs: bigint,
  staleBeforeNs: bigint,
): Promise<DigestClaim> {
  const where = {
    kind_periodKey: { kind: key.kind, periodKey: key.periodKey },
  };
  const existing = await transaction.digestRun.findUnique({ where });
  if (existing === null) {
    await transaction.digestRun.create({
      data: {
        id: crypto.randomUUID(),
        kind: key.kind,
        periodKey: key.periodKey,
        messageId: key.messageId,
        status: "sending",
        createdAtNs: nowNs,
        claimedAtNs: nowNs,
        attemptCount: 1,
      },
    });
    return { outcome: "claimed" };
  }
  const status = DigestStatusSchema.parse(existing.status);
  if (status === "sent" || status === "skipped") {
    return { outcome: "done", status };
  }
  if (
    status === "sending" &&
    existing.claimedAtNs !== null &&
    existing.claimedAtNs > staleBeforeNs
  ) {
    return { outcome: "busy" };
  }
  await transaction.digestRun.update({
    where,
    data: {
      status: "sending",
      claimedAtNs: nowNs,
      attemptCount: { increment: 1 },
    },
  });
  return { outcome: "claimed" };
}

export async function markDigestSentRow(
  prisma: PrismaClient,
  key: DigestRunKey,
  input: { sentAtNs: bigint; subject: string } & DigestArchiveFields,
): Promise<void> {
  await prisma.digestRun.update({
    where: { kind_periodKey: { kind: key.kind, periodKey: key.periodKey } },
    data: {
      ...sentDigestBaseFields(input),
      ...(input.reportPayload === undefined
        ? {}
        : { reportPayload: JsonObjectSchema.parse(input.reportPayload) }),
    },
  });
}

export async function markDigestSkippedRow(
  prisma: PrismaClient,
  key: DigestRunKey,
  input: {
    skipReason: string;
    subject: string;
  } & Required<DigestArchiveFields>,
): Promise<void> {
  await prisma.digestRun.update({
    where: { kind_periodKey: { kind: key.kind, periodKey: key.periodKey } },
    data: {
      status: "skipped",
      skipReason: input.skipReason,
      sentAtNs: null,
      subject: input.subject,
      severity: input.severity,
      summary: input.summary,
      needsMeCount: input.needsMeCount,
      attentionCount: input.attentionCount,
      reportPayload: JsonObjectSchema.parse(input.reportPayload),
      htmlBody: input.htmlBody,
      plainBody: input.plainBody,
      lastError: null,
    },
  });
}

export async function markDigestFailedRow(
  prisma: PrismaClient,
  key: DigestRunKey,
  error: string,
): Promise<void> {
  await prisma.digestRun.update({
    where: { kind_periodKey: { kind: key.kind, periodKey: key.periodKey } },
    data: { status: "failed", lastError: error.slice(0, 2000) },
  });
}

export async function previousCompletedDailyDigestRow(
  prisma: PrismaClient,
  beforePeriodKey: string,
): Promise<CompletedDailyDigestSummary | null> {
  const row = await prisma.digestRun.findFirst({
    where: {
      kind: "daily",
      status: { in: ["sent", "skipped"] },
      periodKey: { lt: beforePeriodKey },
    },
    orderBy: [{ periodKey: "desc" }, { createdAtNs: "desc" }],
    select: {
      periodKey: true,
      status: true,
      severity: true,
      needsMeCount: true,
      attentionCount: true,
    },
  });
  return row === null
    ? null
    : {
        periodKey: row.periodKey,
        status: CompletedDigestStatusSchema.parse(row.status),
        severity: row.severity,
        needsMeCount: row.needsMeCount,
        attentionCount: row.attentionCount,
      };
}
