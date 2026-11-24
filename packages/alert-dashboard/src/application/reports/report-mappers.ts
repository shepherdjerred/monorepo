import type { DigestKind } from "@shepherdjerred/ops-model/digest.ts";
import type { MailboxPair } from "@shepherdjerred/ops-model/email/mailbox.ts";
import type { ReportRunIngestItem } from "@shepherdjerred/ops-model/reports/report-ingest.ts";
import { SeveritySchema as OpsSeveritySchema } from "@shepherdjerred/ops-model/severity.ts";

import type { DigestArchiveFields } from "#application/ports";
import type {
  StoredDigestRun,
  StoredIncidentMail,
  StoredReportRun,
} from "#application/reports/report-ports";
import {
  countActionableFindings,
  countFailedChecks,
} from "#domain/reports/report-email";
import {
  digestRunToDeliveryStatus,
  digestRunToVerdict,
} from "#domain/reports/report-overview";
import { DigestReportSchema, type DigestReport } from "#shared/ops-schema";
import type {
  IncidentMailStatus,
  ReportFeedItem,
  ReportRunSibling,
  ScheduleLatestRun,
} from "#shared/reports-schema";
import {
  epochNanosecondsToInstantText,
  InstantTextSchema,
  instantTextToEpochNanoseconds,
} from "#shared/time";

export function reportRunHref(id: string): string {
  return `/reports/runs/${encodeURIComponent(id)}`;
}

export function digestRunHref(kind: DigestKind, periodKey: string): string {
  return `/reports/digests/${encodeURIComponent(kind)}/${encodeURIComponent(periodKey)}`;
}

export function incidentMailHref(id: string): string {
  return `/reports/mail/${encodeURIComponent(id)}`;
}

function optionalReportRunOutcome(row: StoredReportRun) {
  return {
    subject: row.subject,
    headline: row.envelope.headline,
    verdict: row.verdict,
    deliveryStatus: row.deliveryStatus,
    ...(row.skipReason === null ? {} : { skipReason: row.skipReason }),
    ...(row.prUrl === null ? {} : { prUrl: row.prUrl }),
    ...(row.autoMergeEnabled === null
      ? {}
      : { autoMergeEnabled: row.autoMergeEnabled }),
  };
}

export function toLatestRunSummary(row: StoredReportRun): ScheduleLatestRun {
  return {
    id: row.id,
    runHref: reportRunHref(row.id),
    completedAt: epochNanosecondsToInstantText(row.completedAtNs),
    execution: row.execution,
    ...optionalReportRunOutcome(row),
  };
}

export function toReportRunScalarFields(
  item: ReportRunIngestItem,
  receivedAtNs: bigint,
): Omit<StoredReportRun, "id" | "envelope" | "htmlBody"> {
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
      : instantTextToEpochNanoseconds(InstantTextSchema.parse(item.acceptedAt));
  return {
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
  };
}

export function sentDigestBaseFields(
  input: { sentAtNs: bigint; subject: string } & DigestArchiveFields,
) {
  return {
    status: "sent" as const,
    skipReason: null,
    sentAtNs: input.sentAtNs,
    subject: input.subject,
    ...(input.severity === undefined ? {} : { severity: input.severity }),
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    ...(input.needsMeCount === undefined
      ? {}
      : { needsMeCount: input.needsMeCount }),
    ...(input.attentionCount === undefined
      ? {}
      : { attentionCount: input.attentionCount }),
    ...(input.htmlBody === undefined ? {} : { htmlBody: input.htmlBody }),
    ...(input.plainBody === undefined ? {} : { plainBody: input.plainBody }),
    lastError: null,
  };
}

export function toReportRunSibling(row: StoredReportRun): ReportRunSibling {
  return {
    ...toLatestRunSummary(row),
    findingCount: row.findingCount,
    actionableFindingCount: row.actionableFindingCount,
    failedCheckCount: row.failedCheckCount,
  };
}

export function digestSubjectFallback(row: StoredDigestRun): string {
  const prefix = row.kind === "daily" ? "Daily digest" : "Weekly review";
  return row.subject ?? `${prefix} (${row.periodKey})`;
}

export function digestHeadlineFallback(row: StoredDigestRun): string {
  return (
    row.summary ??
    row.lastError ??
    row.subject ??
    (row.kind === "daily"
      ? `Daily operations digest (${row.periodKey})`
      : `Weekly operations review (${row.periodKey})`)
  );
}

export function digestToLatestRunSummary(
  row: StoredDigestRun,
): ScheduleLatestRun {
  const completedAtNs = row.sentAtNs ?? row.createdAtNs;
  return {
    id: row.id,
    runHref: digestRunHref(row.kind, row.periodKey),
    completedAt: epochNanosecondsToInstantText(completedAtNs),
    subject: digestSubjectFallback(row),
    headline: digestHeadlineFallback(row),
    verdict: digestRunToVerdict(row),
    deliveryStatus: digestRunToDeliveryStatus(row.status),
    ...(row.skipReason === null ? {} : { skipReason: row.skipReason }),
  };
}

export function incidentStatusOf(mail: StoredIncidentMail): IncidentMailStatus {
  if (mail.canceledAtNs !== null) return "canceled";
  if (mail.sentAtNs !== null) return "sent";
  return mail.lastError === null ? "pending" : "failed";
}

export function digestFindingCounts(row: StoredDigestRun): {
  findingCount: number;
  actionableFindingCount: number;
} {
  if (row.reportPayload !== null) {
    const uniqueIds = new Set([
      ...row.reportPayload.needsMe.map((signal) => signal.id),
      ...row.reportPayload.attention.map((signal) => signal.id),
    ]);
    return {
      findingCount: uniqueIds.size,
      actionableFindingCount: row.reportPayload.needsMe.length,
    };
  }
  const needsMe = row.needsMeCount ?? 0;
  const attention = row.attentionCount ?? 0;
  return {
    findingCount: Math.max(needsMe, attention),
    actionableFindingCount: needsMe,
  };
}

export function buildFallbackArchivedDigestReport(
  row: StoredDigestRun,
): DigestReport {
  const parsedSeverity = OpsSeveritySchema.safeParse(row.severity);
  const completedAt = epochNanosecondsToInstantText(
    row.sentAtNs ?? row.createdAtNs,
  );
  return DigestReportSchema.parse({
    kind: row.kind,
    periodKey: row.periodKey,
    periodStart: epochNanosecondsToInstantText(row.createdAtNs),
    periodEnd: completedAt,
    status: {
      severity: parsedSeverity.success ? parsedSeverity.data : "unknown",
      summary: digestHeadlineFallback(row),
      stale: false,
      snapshotGeneratedAt: null,
    },
    attention: [],
    needsMe: [],
    newSinceLast: [],
    changes: [],
    incidents: { opened: 0, resolved: 0, medianMinutesToResolve: null },
    trends: [],
  });
}

export function buildFeedCandidates(input: {
  reportRuns: readonly StoredReportRun[];
  digestRuns: readonly StoredDigestRun[];
  incidentMails: readonly StoredIncidentMail[];
  digestMailbox: MailboxPair;
  incidentMailbox: MailboxPair;
}): (ReportFeedItem & { occurredAtNs: bigint })[] {
  return [
    ...input.reportRuns.map(
      (row): ReportFeedItem & { occurredAtNs: bigint } => ({
        kind:
          row.reportType === "agent-task" ? "agent-task" : "temporal-report",
        id: row.id,
        href: reportRunHref(row.id),
        occurredAt: epochNanosecondsToInstantText(row.completedAtNs),
        occurredAtNs: row.completedAtNs,
        scheduleId: row.scheduleId,
        eyebrow: row.eyebrow,
        title: row.title,
        mailboxFrom: row.mailboxFrom,
        mailboxTo: row.mailboxTo,
        ...optionalReportRunOutcome(row),
        findingCount: row.findingCount,
        actionableFindingCount: row.actionableFindingCount,
        failedCheckCount: row.failedCheckCount,
      }),
    ),
    ...input.digestRuns.map(
      (row): ReportFeedItem & { occurredAtNs: bigint } => {
        const occurredAtNs = row.sentAtNs ?? row.createdAtNs;
        const counts = digestFindingCounts(row);
        return {
          kind: "ops-digest",
          id: row.id,
          href: digestRunHref(row.kind, row.periodKey),
          occurredAt: epochNanosecondsToInstantText(occurredAtNs),
          occurredAtNs,
          scheduleId:
            row.kind === "daily" ? "ops-digest-daily" : "ops-digest-weekly",
          eyebrow: "Hub Digest",
          title:
            row.kind === "daily"
              ? "Daily operations digest"
              : "Weekly operations review",
          subject: digestSubjectFallback(row),
          headline: digestHeadlineFallback(row),
          mailboxFrom: input.digestMailbox.from,
          mailboxTo: input.digestMailbox.to,
          verdict: digestRunToVerdict(row),
          deliveryStatus: digestRunToDeliveryStatus(row.status),
          ...(row.skipReason === null ? {} : { skipReason: row.skipReason }),
          findingCount: counts.findingCount,
          actionableFindingCount: counts.actionableFindingCount,
          failedCheckCount: 0,
        };
      },
    ),
    ...input.incidentMails.map(
      (row): ReportFeedItem & { occurredAtNs: bigint } => {
        const occurredAtNs = row.sentAtNs ?? row.createdAtNs;
        const alertCount = row.occurrenceIds.length;
        return {
          kind: "incident-mail",
          id: row.id,
          href: incidentMailHref(row.id),
          occurredAt: epochNanosecondsToInstantText(occurredAtNs),
          occurredAtNs,
          scheduleId: null,
          eyebrow: "Hub Alerts",
          title:
            alertCount === 0
              ? "Alertmanager truncation notice"
              : `Incident email (${String(alertCount)} alert${alertCount === 1 ? "" : "s"})`,
          subject: row.subject,
          headline: row.lastError ?? row.subject,
          mailboxFrom: input.incidentMailbox.from,
          mailboxTo: input.incidentMailbox.to,
          verdict: "attention",
          deliveryStatus: incidentStatusOf(row),
          findingCount: alertCount,
          actionableFindingCount: alertCount,
          failedCheckCount: 0,
        };
      },
    ),
  ];
}
