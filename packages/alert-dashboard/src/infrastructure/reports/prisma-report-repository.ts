import {
  DigestKindSchema,
  type DigestKind,
} from "@shepherdjerred/ops-model/digest.ts";
import {
  ReportEnvelopeV1Schema,
  ReportExecutionSchema,
  ReportVerdictSchema,
} from "@shepherdjerred/ops-model/reports/report-envelope.ts";
import {
  ReportDeliveryStatusSchema,
  type ReportRunIngestItem,
} from "@shepherdjerred/ops-model/reports/report-ingest.ts";
import { z } from "zod";
import type {
  DigestRun as PrismaDigestRunRow,
  EmailOutbox as PrismaEmailOutboxRow,
  PrismaClient,
  ReportRun as PrismaReportRunRow,
} from "#generated/prisma/client/index.js";

import type {
  ReportRepository,
  StoredDigestRun,
  StoredIncidentMail,
  StoredReportRun,
} from "#application/reports/report-ports";
import { DigestStatusSchema } from "#domain/ops-facet-mappers";
import {
  countActionableFindings,
  countFailedChecks,
} from "#domain/reports/report-email";
import type { AsyncMutex } from "#infrastructure/async-mutex";
import { DigestReportSchema } from "#shared/ops-schema";
import type { IncidentMailOccurrence } from "#shared/reports-schema";
import { JsonObjectSchema } from "#shared/schema";
import {
  epochNanosecondsToInstantText,
  InstantTextSchema,
  instantTextToEpochNanoseconds,
} from "#shared/time";

const StringIdListSchema = z.array(z.string());

function toStoredReportRun(row: PrismaReportRunRow): StoredReportRun {
  return {
    id: row.id,
    reportType: row.reportType,
    scheduleId: row.scheduleId,
    title: row.title,
    eyebrow: row.eyebrow,
    subject: row.subject,
    mailboxFrom: row.mailboxFrom,
    mailboxTo: row.mailboxTo,
    execution: ReportExecutionSchema.parse(row.execution),
    verdict: ReportVerdictSchema.parse(row.verdict),
    deliveryStatus: ReportDeliveryStatusSchema.parse(row.deliveryStatus),
    skipReason: row.skipReason,
    messageId: row.messageId,
    startedAtNs: row.startedAtNs,
    completedAtNs: row.completedAtNs,
    acceptedAtNs: row.acceptedAtNs,
    receivedAtNs: row.receivedAtNs,
    prUrl: row.prUrl,
    autoMergeEnabled: row.autoMergeEnabled,
    workflowId: row.workflowId,
    runId: row.runId,
    temporalUrl: row.temporalUrl,
    repoSha: row.repoSha,
    findingCount: row.findingCount,
    actionableFindingCount: row.actionableFindingCount,
    failedCheckCount: row.failedCheckCount,
    envelope: ReportEnvelopeV1Schema.parse(row.envelope),
    htmlBody: row.htmlBody,
  };
}

function toStoredDigestRun(row: PrismaDigestRunRow): StoredDigestRun {
  const parsedReport =
    row.reportPayload === null
      ? null
      : DigestReportSchema.safeParse(row.reportPayload);
  return {
    id: row.id,
    kind: DigestKindSchema.parse(row.kind),
    periodKey: row.periodKey,
    status: DigestStatusSchema.parse(row.status),
    skipReason: row.skipReason,
    createdAtNs: row.createdAtNs,
    claimedAtNs: row.claimedAtNs,
    sentAtNs: row.sentAtNs,
    attemptCount: row.attemptCount,
    messageId: row.messageId,
    subject: row.subject,
    lastError: row.lastError,
    severity: row.severity,
    summary: row.summary,
    needsMeCount: row.needsMeCount,
    attentionCount: row.attentionCount,
    reportPayload: parsedReport?.success === true ? parsedReport.data : null,
    htmlBody: row.htmlBody,
    plainBody: row.plainBody,
  };
}

function toStoredIncidentMail(row: PrismaEmailOutboxRow): StoredIncidentMail {
  const parsedOccurrenceIds = StringIdListSchema.safeParse(row.occurrenceIds);
  return {
    id: row.id,
    messageId: row.messageId,
    deliveryId: row.deliveryId,
    createdAtNs: row.createdAtNs,
    sentAtNs: row.sentAtNs,
    canceledAtNs: row.canceledAtNs,
    canceledBy: row.canceledBy,
    cancellationReason: row.cancellationReason,
    attemptCount: row.attemptCount,
    lastError: row.lastError,
    occurrenceIds: parsedOccurrenceIds.success ? parsedOccurrenceIds.data : [],
    subject: row.subject,
    htmlBody: row.htmlBody,
    plainBody: row.plainBody,
  };
}

export class PrismaReportRepository implements ReportRepository {
  readonly #prisma: PrismaClient;
  readonly #writeMutex: AsyncMutex;

  constructor(prisma: PrismaClient, writeMutex: AsyncMutex) {
    this.#prisma = prisma;
    this.#writeMutex = writeMutex;
  }

  async upsertReportRuns(
    items: readonly ReportRunIngestItem[],
    receivedAtNs: bigint,
  ): Promise<{ accepted: number }> {
    return this.#writeMutex.runExclusive(() =>
      this.#prisma.$transaction(async (transaction) => {
        for (const item of items) {
          const { report } = item;
          const startedAtNs = instantTextToEpochNanoseconds(
            InstantTextSchema.parse(report.startedAt),
          );
          const completedAtNs = instantTextToEpochNanoseconds(
            InstantTextSchema.parse(report.completedAt),
          );
          const acceptedAtNs =
            item.acceptedAt === undefined
              ? null
              : instantTextToEpochNanoseconds(
                  InstantTextSchema.parse(item.acceptedAt),
                );
          const sharedFields = {
            reportType: report.reportType,
            scheduleId: report.scheduleId ?? null,
            title: report.title,
            eyebrow: item.eyebrow,
            subject: item.subject,
            mailboxFrom: item.mailboxFrom,
            mailboxTo: item.mailboxTo,
            execution: report.execution,
            verdict: report.verdict,
            deliveryStatus: item.deliveryStatus,
            skipReason: item.skipReason ?? null,
            messageId: item.messageId ?? null,
            startedAtNs,
            completedAtNs,
            acceptedAtNs,
            receivedAtNs,
            prUrl: report.remediation?.prUrl ?? null,
            autoMergeEnabled: report.remediation?.autoMergeEnabled ?? null,
            workflowId: report.provenance.workflowId,
            runId: report.provenance.runId,
            temporalUrl: report.provenance.temporalUrl ?? null,
            repoSha: report.provenance.repoSha ?? null,
            findingCount: report.findings.length,
            actionableFindingCount: countActionableFindings(report.findings),
            failedCheckCount: countFailedChecks(report.checks),
            envelope: JsonObjectSchema.parse(report),
          };
          await transaction.reportRun.upsert({
            where: { id: report.reportRunId },
            create: {
              id: report.reportRunId,
              ...sharedFields,
              htmlBody: item.htmlBody ?? null,
            },
            update: {
              ...sharedFields,
              ...(item.htmlBody === undefined
                ? {}
                : { htmlBody: item.htmlBody }),
            },
          });
        }
        return { accepted: items.length };
      }),
    );
  }

  async listReportRuns(options?: {
    sinceCompletedAtNs?: bigint;
    scheduleId?: string;
    reportType?: string;
    limit?: number;
  }): Promise<readonly StoredReportRun[]> {
    const rows = await this.#prisma.reportRun.findMany({
      where: {
        ...(options?.sinceCompletedAtNs === undefined
          ? {}
          : { completedAtNs: { gte: options.sinceCompletedAtNs } }),
        ...(options?.scheduleId === undefined
          ? {}
          : { scheduleId: options.scheduleId }),
        ...(options?.reportType === undefined
          ? {}
          : { reportType: options.reportType }),
      },
      orderBy: [{ completedAtNs: "desc" }, { id: "desc" }],
      ...(options?.limit === undefined ? {} : { take: options.limit }),
    });
    return rows.map((row) => toStoredReportRun(row));
  }

  async listLatestRunsPerSchedule(
    scheduleIds: readonly string[],
  ): Promise<ReadonlyMap<string, StoredReportRun>> {
    const entries = await Promise.all(
      scheduleIds.map(async (scheduleId) => {
        const row = await this.#prisma.reportRun.findFirst({
          where: { scheduleId },
          orderBy: [{ completedAtNs: "desc" }, { id: "desc" }],
        });
        return row === null
          ? null
          : ([scheduleId, toStoredReportRun(row)] as const);
      }),
    );
    return new Map(entries.filter((entry) => entry !== null));
  }

  async getReportRun(id: string): Promise<StoredReportRun | null> {
    const row = await this.#prisma.reportRun.findUnique({ where: { id } });
    return row === null ? null : toStoredReportRun(row);
  }

  async listRecentScheduleRuns(
    scheduleId: string,
    limit: number,
  ): Promise<readonly StoredReportRun[]> {
    const rows = await this.#prisma.reportRun.findMany({
      where: { scheduleId },
      orderBy: [{ completedAtNs: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows.map((row) => toStoredReportRun(row));
  }

  async listDigestRuns(options?: {
    sinceCreatedAtNs?: bigint;
    kind?: DigestKind;
    limit?: number;
  }): Promise<readonly StoredDigestRun[]> {
    const rows = await this.#prisma.digestRun.findMany({
      where: {
        ...(options?.sinceCreatedAtNs === undefined
          ? {}
          : { createdAtNs: { gte: options.sinceCreatedAtNs } }),
        ...(options?.kind === undefined ? {} : { kind: options.kind }),
      },
      orderBy: [{ createdAtNs: "desc" }, { id: "desc" }],
      ...(options?.limit === undefined ? {} : { take: options.limit }),
    });
    return rows.map((row) => toStoredDigestRun(row));
  }

  async listLatestDigestsByKind(): Promise<{
    daily: StoredDigestRun | null;
    weekly: StoredDigestRun | null;
  }> {
    const [daily, weekly] = await Promise.all([
      this.#prisma.digestRun.findFirst({
        where: { kind: "daily", status: { in: ["sent", "skipped", "failed"] } },
        orderBy: [{ periodKey: "desc" }, { createdAtNs: "desc" }],
      }),
      this.#prisma.digestRun.findFirst({
        where: {
          kind: "weekly",
          status: { in: ["sent", "skipped", "failed"] },
        },
        orderBy: [{ periodKey: "desc" }, { createdAtNs: "desc" }],
      }),
    ]);
    return {
      daily: daily === null ? null : toStoredDigestRun(daily),
      weekly: weekly === null ? null : toStoredDigestRun(weekly),
    };
  }

  async getDigestRun(
    kind: DigestKind,
    periodKey: string,
  ): Promise<StoredDigestRun | null> {
    const row = await this.#prisma.digestRun.findUnique({
      where: { kind_periodKey: { kind, periodKey } },
    });
    return row === null ? null : toStoredDigestRun(row);
  }

  async listIncidentMails(
    limit: number,
  ): Promise<readonly StoredIncidentMail[]> {
    const rows = await this.#prisma.emailOutbox.findMany({
      orderBy: [{ createdAtNs: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows.map((row) => toStoredIncidentMail(row));
  }

  async getIncidentMail(id: string): Promise<{
    mail: StoredIncidentMail;
    occurrences: readonly IncidentMailOccurrence[];
  } | null> {
    const row = await this.#prisma.emailOutbox.findUnique({ where: { id } });
    if (row === null) return null;
    const mail = toStoredIncidentMail(row);
    const occurrenceRows =
      mail.occurrenceIds.length === 0
        ? []
        : await this.#prisma.alertOccurrence.findMany({
            where: { id: { in: [...mail.occurrenceIds] } },
            orderBy: [{ openedAtNs: "desc" }, { id: "desc" }],
            select: {
              id: true,
              alertname: true,
              severity: true,
              summary: true,
              lifecycleState: true,
              openedAtNs: true,
            },
          });
    return {
      mail,
      occurrences: occurrenceRows.map((occ) => ({
        id: occ.id,
        alertname: occ.alertname,
        severity: occ.severity,
        summary: occ.summary,
        lifecycleState: occ.lifecycleState,
        openedAt: epochNanosecondsToInstantText(occ.openedAtNs),
      })),
    };
  }

  async incidentOutboxCounts(): Promise<{ pending: number; failed: number }> {
    const [pending, failed] = await Promise.all([
      this.#prisma.emailOutbox.count({
        where: { sentAtNs: null, canceledAtNs: null, lastError: null },
      }),
      this.#prisma.emailOutbox.count({
        where: {
          sentAtNs: null,
          canceledAtNs: null,
          lastError: { not: null },
        },
      }),
    ]);
    return { pending, failed };
  }
}
