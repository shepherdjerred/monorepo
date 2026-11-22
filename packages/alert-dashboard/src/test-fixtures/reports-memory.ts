import type { DigestKind } from "@shepherdjerred/ops-model/digest.ts";
import type { ReportVerdict } from "@shepherdjerred/ops-model/reports/report-envelope.ts";
import type {
  ReportDeliveryStatus,
  ReportRunIngestItem,
} from "@shepherdjerred/ops-model/reports/report-ingest.ts";

import type {
  ReportFeedCursor,
  ReportRepository,
  StoredDigestRun,
  StoredIncidentMail,
  StoredReportRun,
} from "#application/reports/report-ports";
import {
  countActionableFindings,
  countFailedChecks,
} from "#domain/reports/report-email";
import type { IncidentMailOccurrence } from "#shared/reports-schema";
import { InstantTextSchema, instantTextToEpochNanoseconds } from "#shared/time";
import { InMemoryOpsRepository } from "#test-fixtures/ops-memory";

function compareRunsDesc(
  left: StoredReportRun,
  right: StoredReportRun,
): number {
  if (left.completedAtNs !== right.completedAtNs) {
    return left.completedAtNs > right.completedAtNs ? -1 : 1;
  }
  return right.id.localeCompare(left.id);
}

function isBeforeCursor(
  timestampNs: bigint,
  id: string,
  before: ReportFeedCursor | undefined,
): boolean {
  return (
    before === undefined ||
    timestampNs < before.timestampNs ||
    (timestampNs === before.timestampNs && id < before.id)
  );
}

function matchesReportRunOptions(
  row: StoredReportRun,
  options:
    | {
        sinceCompletedAtNs?: bigint;
        scheduleId?: string;
        reportType?: string;
        excludeReportType?: string;
        verdict?: ReportVerdict;
        deliveryStatus?: ReportDeliveryStatus;
        hasPr?: boolean;
        before?: ReportFeedCursor;
      }
    | undefined,
): boolean {
  return (
    options === undefined ||
    ((options.sinceCompletedAtNs === undefined ||
      row.completedAtNs >= options.sinceCompletedAtNs) &&
      (options.scheduleId === undefined ||
        row.scheduleId === options.scheduleId) &&
      (options.reportType === undefined ||
        row.reportType === options.reportType) &&
      (options.excludeReportType === undefined ||
        row.reportType !== options.excludeReportType) &&
      (options.verdict === undefined || row.verdict === options.verdict) &&
      (options.deliveryStatus === undefined ||
        row.deliveryStatus === options.deliveryStatus) &&
      (options.hasPr !== true || row.prUrl !== null) &&
      isBeforeCursor(row.completedAtNs, row.id, options.before))
  );
}

export class MemoryReportRepository implements ReportRepository {
  readonly runs = new Map<string, StoredReportRun>();
  readonly incidentMails = new Map<string, StoredIncidentMail>();
  readonly incidentOccurrences = new Map<string, IncidentMailOccurrence>();
  readonly #opsRepository: InMemoryOpsRepository;

  constructor(opsRepository = new InMemoryOpsRepository()) {
    this.#opsRepository = opsRepository;
  }

  upsertReportRuns(
    items: readonly ReportRunIngestItem[],
    receivedAtNs: bigint,
  ): Promise<{ accepted: number }> {
    for (const item of items) {
      const { report } = item;
      const existing = this.runs.get(report.reportRunId);
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
      this.runs.set(report.reportRunId, {
        id: report.reportRunId,
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
        envelope: report,
        htmlBody: item.htmlBody ?? existing?.htmlBody ?? null,
      });
    }
    return Promise.resolve({ accepted: items.length });
  }

  listReportRuns(options?: {
    sinceCompletedAtNs?: bigint;
    scheduleId?: string;
    reportType?: string;
    excludeReportType?: string;
    verdict?: ReportVerdict;
    deliveryStatus?: ReportDeliveryStatus;
    hasPr?: boolean;
    before?: ReportFeedCursor;
    limit?: number;
  }): Promise<readonly StoredReportRun[]> {
    const filtered = [...this.runs.values()]
      .filter((row) => matchesReportRunOptions(row, options))
      .toSorted(compareRunsDesc);
    return Promise.resolve(
      options?.limit === undefined
        ? filtered
        : filtered.slice(0, options.limit),
    );
  }

  listLatestRunsPerSchedule(
    scheduleIds: readonly string[],
  ): Promise<ReadonlyMap<string, StoredReportRun>> {
    const result = new Map<string, StoredReportRun>();
    for (const scheduleId of scheduleIds) {
      const candidates = [...this.runs.values()]
        .filter((row) => row.scheduleId === scheduleId)
        .toSorted(compareRunsDesc);
      const latest = candidates[0];
      if (latest !== undefined) {
        result.set(scheduleId, latest);
      }
    }
    return Promise.resolve(result);
  }

  getReportRun(id: string): Promise<StoredReportRun | null> {
    return Promise.resolve(this.runs.get(id) ?? null);
  }

  listRecentScheduleRuns(
    scheduleId: string,
    limit: number,
  ): Promise<readonly StoredReportRun[]> {
    return this.listReportRuns({ scheduleId, limit });
  }

  listDigestRuns(options?: {
    sinceCreatedAtNs?: bigint;
    kind?: DigestKind;
    before?: ReportFeedCursor;
    limit?: number;
  }): Promise<readonly StoredDigestRun[]> {
    const filtered = [...this.#opsRepository.digests.values()]
      .filter(
        (row) =>
          (options?.sinceCreatedAtNs === undefined ||
            row.createdAtNs >= options.sinceCreatedAtNs) &&
          (options?.kind === undefined || row.kind === options.kind) &&
          isBeforeCursor(row.createdAtNs, row.id, options?.before),
      )
      .toSorted((left, right) =>
        left.createdAtNs === right.createdAtNs
          ? right.id.localeCompare(left.id)
          : left.createdAtNs > right.createdAtNs
            ? -1
            : 1,
      );
    return Promise.resolve(
      options?.limit === undefined
        ? filtered
        : filtered.slice(0, options.limit),
    );
  }

  listLatestDigestsByKind(): Promise<{
    daily: StoredDigestRun | null;
    weekly: StoredDigestRun | null;
  }> {
    const latestOf = (kind: DigestKind): StoredDigestRun | null => {
      const candidates = [...this.#opsRepository.digests.values()]
        .filter(
          (row) =>
            row.kind === kind &&
            (row.status === "sent" ||
              row.status === "skipped" ||
              row.status === "failed"),
        )
        .toSorted((left, right) =>
          left.periodKey === right.periodKey
            ? left.createdAtNs > right.createdAtNs
              ? -1
              : 1
            : right.periodKey.localeCompare(left.periodKey),
        );
      return candidates[0] ?? null;
    };
    return Promise.resolve({
      daily: latestOf("daily"),
      weekly: latestOf("weekly"),
    });
  }

  getDigestRun(
    kind: DigestKind,
    periodKey: string,
  ): Promise<StoredDigestRun | null> {
    return Promise.resolve(
      this.#opsRepository.digests.get(`${kind}:${periodKey}`) ?? null,
    );
  }

  listIncidentMails(options: {
    limit: number;
    before?: ReportFeedCursor;
  }): Promise<readonly StoredIncidentMail[]> {
    return Promise.resolve(
      [...this.incidentMails.values()]
        .filter((row) =>
          isBeforeCursor(row.createdAtNs, row.id, options.before),
        )
        .toSorted((left, right) =>
          left.createdAtNs === right.createdAtNs
            ? right.id.localeCompare(left.id)
            : left.createdAtNs > right.createdAtNs
              ? -1
              : 1,
        )
        .slice(0, options.limit),
    );
  }

  getIncidentMail(id: string): Promise<{
    mail: StoredIncidentMail;
    occurrences: readonly IncidentMailOccurrence[];
  } | null> {
    const mail = this.incidentMails.get(id);
    if (mail === undefined) return Promise.resolve(null);
    const occurrences = mail.occurrenceIds
      .flatMap((occId) => {
        const occ = this.incidentOccurrences.get(occId);
        return occ === undefined ? [] : [occ];
      })
      .toSorted((left, right) =>
        left.openedAt === right.openedAt
          ? right.id.localeCompare(left.id)
          : right.openedAt.localeCompare(left.openedAt),
      );
    return Promise.resolve({ mail, occurrences });
  }

  incidentOutboxCounts(): Promise<{ pending: number; failed: number }> {
    let pending = 0;
    let failed = 0;
    for (const mail of this.incidentMails.values()) {
      if (mail.sentAtNs !== null || mail.canceledAtNs !== null) continue;
      if (mail.lastError === null) {
        pending += 1;
      } else {
        failed += 1;
      }
    }
    return Promise.resolve({ pending, failed });
  }
}
