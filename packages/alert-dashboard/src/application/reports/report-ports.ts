import type { DigestKind } from "@shepherdjerred/ops-model/digest.ts";
import type {
  ReportEnvelopeV1,
  ReportExecution,
  ReportVerdict,
} from "@shepherdjerred/ops-model/reports/report-envelope.ts";
import type {
  ReportDeliveryStatus,
  ReportRunIngestItem,
} from "@shepherdjerred/ops-model/reports/report-ingest.ts";

import type { DigestReport } from "#shared/ops-schema";
import type { IncidentMailOccurrence } from "#shared/reports-schema";

export type StoredReportRun = {
  id: string;
  reportType: string;
  scheduleId: string | null;
  title: string;
  eyebrow: string;
  subject: string;
  mailboxFrom: string;
  mailboxTo: string;
  execution: ReportExecution;
  verdict: ReportVerdict;
  deliveryStatus: ReportDeliveryStatus;
  skipReason: string | null;
  messageId: string | null;
  startedAtNs: bigint;
  completedAtNs: bigint;
  acceptedAtNs: bigint | null;
  receivedAtNs: bigint;
  prUrl: string | null;
  autoMergeEnabled: boolean | null;
  workflowId: string;
  runId: string;
  temporalUrl: string | null;
  repoSha: string | null;
  findingCount: number;
  actionableFindingCount: number;
  failedCheckCount: number;
  envelope: ReportEnvelopeV1;
  htmlBody: string | null;
};

export type StoredDigestRun = {
  id: string;
  kind: DigestKind;
  periodKey: string;
  status: "sending" | "sent" | "skipped" | "failed";
  skipReason: string | null;
  createdAtNs: bigint;
  claimedAtNs: bigint | null;
  sentAtNs: bigint | null;
  attemptCount: number;
  messageId: string;
  subject: string | null;
  lastError: string | null;
  severity: string | null;
  summary: string | null;
  needsMeCount: number | null;
  attentionCount: number | null;
  reportPayload: DigestReport | null;
  htmlBody: string | null;
  plainBody: string | null;
};

export type StoredIncidentMail = {
  id: string;
  messageId: string;
  deliveryId: string;
  createdAtNs: bigint;
  sentAtNs: bigint | null;
  canceledAtNs: bigint | null;
  canceledBy: string | null;
  cancellationReason: string | null;
  attemptCount: number;
  lastError: string | null;
  occurrenceIds: readonly string[];
  subject: string;
  htmlBody: string;
  plainBody: string | null;
};

export type ReportFeedCursor = {
  readonly timestampNs: bigint;
  readonly id: string;
};

export type ReportRepository = {
  upsertReportRuns: (
    items: readonly ReportRunIngestItem[],
    receivedAtNs: bigint,
  ) => Promise<{ accepted: number }>;
  listReportRuns: (options?: {
    sinceCompletedAtNs?: bigint;
    scheduleId?: string;
    reportType?: string;
    excludeReportType?: string;
    verdict?: ReportVerdict;
    deliveryStatus?: ReportDeliveryStatus;
    hasPr?: boolean;
    before?: ReportFeedCursor;
    limit?: number;
  }) => Promise<readonly StoredReportRun[]>;
  listLatestRunsPerSchedule: (
    scheduleIds: readonly string[],
  ) => Promise<ReadonlyMap<string, StoredReportRun>>;
  getReportRun: (id: string) => Promise<StoredReportRun | null>;
  listRecentScheduleRuns: (
    scheduleId: string,
    limit: number,
  ) => Promise<readonly StoredReportRun[]>;
  listDigestRuns: (options?: {
    sinceCreatedAtNs?: bigint;
    kind?: DigestKind;
    before?: ReportFeedCursor;
    limit?: number;
  }) => Promise<readonly StoredDigestRun[]>;
  listLatestDigestsByKind: () => Promise<{
    daily: StoredDigestRun | null;
    weekly: StoredDigestRun | null;
  }>;
  getDigestRun: (
    kind: DigestKind,
    periodKey: string,
  ) => Promise<StoredDigestRun | null>;
  listIncidentMails: (options: {
    limit: number;
    before?: ReportFeedCursor;
  }) => Promise<readonly StoredIncidentMail[]>;
  getIncidentMail: (id: string) => Promise<{
    mail: StoredIncidentMail;
    occurrences: readonly IncidentMailOccurrence[];
  } | null>;
  incidentOutboxCounts: () => Promise<{
    pending: number;
    failed: number;
  }>;
};
