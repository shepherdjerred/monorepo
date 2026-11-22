import type { Temporal } from "@js-temporal/polyfill";
import { OPS_MAILBOXES } from "@shepherdjerred/ops-model/email/mailbox.ts";
import {
  ReportRunIngestBatchSchema,
  type ReportRunIngestBatch,
  type ReportRunIngestItemInput,
} from "@shepherdjerred/ops-model/reports/report-ingest.ts";
import { TEMPORAL_REPORT_SCHEDULES } from "@shepherdjerred/ops-model/reports/schedule-catalog.ts";

import { renderDigestEmail } from "#domain/ops-digest-email";
import { digestMessageId, digestPeriod } from "#domain/ops-period";
import { DigestReportSchema } from "#shared/ops-schema";
import { epochNanosecondsToInstantText } from "#shared/time";
import type { InMemoryOpsRepository } from "#test-fixtures/ops-memory";
import type { MemoryReportRepository } from "#test-fixtures/reports-memory";

function clearEnvelopeItem(input: {
  scheduleId: string;
  reportType: string;
  title: string;
  eyebrow: string;
  mailboxFrom: string;
  mailboxTo: string;
  completedAt: Temporal.Instant;
  deliveryStatus: "sent" | "skipped";
  skipReason?: "unchanged";
  runSuffix: string;
}): ReportRunIngestItemInput {
  const startedAt = input.completedAt.subtract({ seconds: 45 }).toString();
  const completedAt = input.completedAt.toString();
  const reportRunId = `${input.scheduleId}:${input.runSuffix}`;
  return {
    report: {
      schemaVersion: 1,
      reportRunId,
      reportType: input.reportType,
      title: input.title,
      scheduleId: input.scheduleId,
      startedAt,
      completedAt,
      execution: "complete",
      verdict: "clear",
      headline: `All required checks passed for ${input.title.toLowerCase()}.`,
      checks: [
        {
          id: "primary-check",
          label: "Primary verification",
          required: true,
          status: "passed",
          summary: "Collected fresh upstream state with zero active findings.",
          evidenceReceiptIds: [`receipt-${input.runSuffix}`],
        },
      ],
      evidence: [
        {
          id: `receipt-${input.runSuffix}`,
          source: input.reportType,
          origin: "declared-collector",
          semanticStatus: "passed",
          observedAt: startedAt,
          status: "success",
          exitCode: 0,
        },
      ],
      findings: [],
      limitations: [],
      actions: [],
      provenance: {
        workflowId: `${input.scheduleId}-${input.runSuffix}`,
        runId: `run-${input.runSuffix}`,
        repoSha: "1aa6a3204f00",
      },
    },
    subject: `${input.eyebrow}: All clear`,
    eyebrow: input.eyebrow,
    mailboxFrom: input.mailboxFrom,
    mailboxTo: input.mailboxTo,
    deliveryStatus: input.deliveryStatus,
    ...(input.skipReason === undefined ? {} : { skipReason: input.skipReason }),
    ...(input.deliveryStatus === "sent"
      ? {
          messageId: `<${reportRunId}@sjer.red>`,
          acceptedAt: input.completedAt.add({ seconds: 2 }).toString(),
        }
      : {}),
  };
}

export function fixtureReportIngestBatch(
  now: Temporal.Instant,
): ReportRunIngestBatch {
  const items: ReportRunIngestItemInput[] = [];

  for (const [index, schedule] of TEMPORAL_REPORT_SCHEDULES.entries()) {
    const completedAt = now.subtract({ minutes: 15 + index * 9 });

    if (schedule.scheduleId === "link-rot-scan-weekly") {
      items.push({
        report: {
          schemaVersion: 1,
          reportRunId: "link-rot-scan-weekly:latest",
          reportType: schedule.reportType,
          title: schedule.title,
          scheduleId: schedule.scheduleId,
          startedAt: completedAt.subtract({ minutes: 2 }).toString(),
          completedAt: completedAt.toString(),
          execution: "complete",
          verdict: "changed",
          headline:
            "Updated 2 redirected documentation links and enabled auto-merge.",
          checks: [
            {
              id: "url-scan",
              label: "Documentation link verification",
              required: true,
              status: "passed",
              summary: "Scanned 318 links across docs and READMEs.",
              evidenceReceiptIds: ["receipt-link-rot"],
            },
          ],
          evidence: [
            {
              id: "receipt-link-rot",
              source: "link-scanner",
              origin: "declared-collector",
              semanticStatus: "passed",
              observedAt: completedAt.subtract({ minutes: 1 }).toString(),
              status: "success",
              url: "https://github.com/shepherdjerred/monorepo",
              exitCode: 0,
            },
          ],
          findings: [],
          limitations: [],
          actions: [],
          remediation: {
            outcome: "pr-created",
            prUrl: "https://github.com/shepherdjerred/monorepo/pull/3071",
            branchName: "auto/link-rot-scan",
            commitSha: "1aa6a3204f00",
            autoMergeEnabled: true,
            changedFiles: ["packages/docs/README.md"],
            resolvedCount: 2,
            unresolvedCount: 0,
            summary: "Rewrote two permanent 301 redirects to canonical URLs.",
          },
          provenance: {
            workflowId: "link-rot-scan-weekly-latest",
            runId: "run-link-rot-latest",
            temporalUrl:
              "https://temporal-ui.tailnet-1a49.ts.net/namespaces/prod/workflows/link-rot-scan-weekly-latest",
            repoSha: "1aa6a3204f00",
          },
        },
        subject: "Link check: Auto-remediation PR opened (2 links updated)",
        eyebrow: schedule.eyebrow,
        mailboxFrom: schedule.mailbox.from,
        mailboxTo: schedule.mailbox.to,
        deliveryStatus: "sent",
        messageId: "<link-rot-scan-weekly-latest@sjer.red>",
        acceptedAt: completedAt.add({ seconds: 3 }).toString(),
      });
      continue;
    }

    if (schedule.scheduleId === "main-vuln-scan-weekly") {
      items.push({
        report: {
          schemaVersion: 1,
          reportRunId: "main-vuln-scan-weekly:latest",
          reportType: schedule.reportType,
          title: schedule.title,
          scheduleId: schedule.scheduleId,
          startedAt: completedAt.subtract({ minutes: 3 }).toString(),
          completedAt: completedAt.toString(),
          execution: "complete",
          verdict: "attention",
          headline: "1 transitive advisory requires manual review.",
          checks: [
            {
              id: "osv-audit",
              label: "Workspace vulnerability audit",
              required: true,
              status: "failed",
              summary: "Found 1 moderate advisory in transitive dependency.",
              evidenceReceiptIds: ["receipt-vuln-scan"],
            },
          ],
          evidence: [
            {
              id: "receipt-vuln-scan",
              source: "bun-audit",
              origin: "declared-collector",
              semanticStatus: "failed",
              observedAt: completedAt.subtract({ minutes: 1 }).toString(),
              status: "success",
              exitCode: 1,
            },
          ],
          findings: [
            {
              id: "ghsa-sample-1",
              state: "active",
              section: "Dependencies",
              severity: "warning",
              summary: "Moderate advisory awaiting upstream patch release",
              detail:
                "Opened review PR with pinned override for operator sign-off.",
              evidenceReceiptIds: ["receipt-vuln-scan"],
            },
          ],
          limitations: [],
          actions: ["Review remediation PR #3072 before merging."],
          remediation: {
            outcome: "pr-created",
            prUrl: "https://github.com/shepherdjerred/monorepo/pull/3072",
            branchName: "auto/vuln-remediation",
            commitSha: "2bb7b4315e11",
            autoMergeEnabled: false,
            changedFiles: ["package.json", "bun.lock"],
            resolvedCount: 1,
            unresolvedCount: 0,
            summary: "Added temporary override and verified workspace tests.",
          },
          provenance: {
            workflowId: "main-vuln-scan-weekly-latest",
            runId: "run-vuln-latest",
            repoSha: "1aa6a3204f00",
          },
        },
        subject: "Security scan: 1 advisory needs review (PR #3072)",
        eyebrow: schedule.eyebrow,
        mailboxFrom: schedule.mailbox.from,
        mailboxTo: schedule.mailbox.to,
        deliveryStatus: "sent",
        messageId: "<main-vuln-scan-weekly-latest@sjer.red>",
        acceptedAt: completedAt.add({ seconds: 2 }).toString(),
      });
      continue;
    }

    const quietSkip = schedule.notificationPolicy === "daily-changed";
    items.push(
      clearEnvelopeItem({
        scheduleId: schedule.scheduleId,
        reportType: schedule.reportType,
        title: schedule.title,
        eyebrow: schedule.eyebrow,
        mailboxFrom: schedule.mailbox.from,
        mailboxTo: schedule.mailbox.to,
        completedAt,
        deliveryStatus: quietSkip ? "skipped" : "sent",
        ...(quietSkip ? { skipReason: "unchanged" as const } : {}),
        runSuffix: "latest",
      }),
    );
  }

  // Ad-hoc agent task run for the Agent Tasks tab.
  const agentCompletedAt = now.subtract({ hours: 3 });
  items.push({
    report: {
      schemaVersion: 1,
      reportRunId: "agent-task:compat-check-1",
      reportType: "agent-task",
      title: "Agent task: Talos upgrade preflight audit",
      startedAt: agentCompletedAt.subtract({ minutes: 4 }).toString(),
      completedAt: agentCompletedAt.toString(),
      execution: "complete",
      verdict: "clear",
      headline:
        "Verified Talos node extensions, etcd quorum, and PDB readiness.",
      checks: [
        {
          id: "talos-preflight",
          label: "Cluster node preflight",
          required: true,
          status: "passed",
          summary: "All 3 control-plane and worker nodes passed preflight.",
          evidenceReceiptIds: ["receipt-agent-1"],
        },
      ],
      evidence: [
        {
          id: "receipt-agent-1",
          source: "talos-preflight-collector",
          origin: "declared-collector",
          semanticStatus: "passed",
          observedAt: agentCompletedAt.subtract({ minutes: 1 }).toString(),
          status: "success",
          exitCode: 0,
        },
      ],
      findings: [],
      limitations: [],
      actions: [],
      provenance: {
        workflowId: "agent-task-talos-preflight",
        runId: "run-agent-1",
        repoSha: "1aa6a3204f00",
      },
    },
    subject: "Agent task: Talos upgrade preflight passed",
    eyebrow: "Agent Task",
    mailboxFrom: OPS_MAILBOXES.reports.general.from,
    mailboxTo: OPS_MAILBOXES.reports.general.to,
    deliveryStatus: "sent",
    messageId: "<agent-task-compat-check-1@sjer.red>",
    acceptedAt: agentCompletedAt.add({ seconds: 2 }).toString(),
  });

  return ReportRunIngestBatchSchema.parse({ items });
}

export async function seedReportFixtures(input: {
  reportsRepository: MemoryReportRepository;
  opsRepository: InMemoryOpsRepository;
  now: Temporal.Instant;
}): Promise<void> {
  const { reportsRepository, opsRepository, now } = input;
  const batch = fixtureReportIngestBatch(now);
  await reportsRepository.upsertReportRuns(batch.items, now.epochNanoseconds);

  // Seed historical daily digests (yesterday skipped quiet-clear, 2d ago sent clear)
  // and last weekly digest without mutating the live `digest` ViewerCursor.
  const twoDaysAgo = now.subtract({ hours: 48 });
  const yesterday = now.subtract({ hours: 24 });
  const twoDaysPeriod = digestPeriod("daily", twoDaysAgo);
  const yesterdayPeriod = digestPeriod("daily", yesterday);
  const weeklyInstant = now.subtract({ hours: 12 });
  const weeklyPeriod = digestPeriod("weekly", weeklyInstant);

  for (const [entryNow, period, status, skipReason] of [
    [twoDaysAgo, twoDaysPeriod, "sent", null],
    [yesterday, yesterdayPeriod, "skipped", "unchanged-clear"],
    [weeklyInstant, weeklyPeriod, "sent", null],
  ] as const) {
    const report = DigestReportSchema.parse({
      kind: period.kind,
      periodKey: period.key,
      periodStart: epochNanosecondsToInstantText(period.start.epochNanoseconds),
      periodEnd: epochNanosecondsToInstantText(period.end.epochNanoseconds),
      status: {
        severity: "ok",
        summary: "All monitored areas are healthy",
        stale: false,
        snapshotGeneratedAt: epochNanosecondsToInstantText(
          entryNow.subtract({ minutes: 2 }).epochNanoseconds,
        ),
      },
      attention: [],
      needsMe: [],
      newSinceLast: [],
      changes: [],
      incidents: { opened: 0, resolved: 0, medianMinutesToResolve: null },
      trends: [],
    });
    const rendered = renderDigestEmail(report);
    opsRepository.digests.set(`${period.kind}:${period.key}`, {
      id: `digest-${period.kind}-${period.key}`,
      kind: period.kind,
      periodKey: period.key,
      status,
      skipReason,
      createdAtNs: entryNow.epochNanoseconds,
      claimedAtNs: entryNow.epochNanoseconds,
      sentAtNs: status === "sent" ? entryNow.epochNanoseconds : null,
      attemptCount: 1,
      attempts: 1,
      messageId: digestMessageId(period.kind, period.key),
      subject: rendered.subject,
      lastError: null,
      severity: "ok",
      summary: report.status.summary,
      needsMeCount: 0,
      attentionCount: 0,
      reportPayload: report,
      htmlBody: rendered.htmlBody,
      plainBody: rendered.plainBody,
    });
  }

  // Seed one sent incident mail item linked to the fixture DiskFull occurrence.
  const alertId = `alert_${"a".repeat(32)}`;
  const mailId = "123e4567-e89b-42d3-a456-426614174099";
  const mailCreatedNs = now.subtract({ hours: 4 }).epochNanoseconds;
  reportsRepository.incidentOccurrences.set(alertId, {
    id: alertId,
    alertname: "DiskFull",
    severity: "warning",
    summary: "Storage volume is nearly full",
    lifecycleState: "open",
    openedAt: epochNanosecondsToInstantText(mailCreatedNs),
  });
  reportsRepository.incidentMails.set(mailId, {
    id: mailId,
    messageId: `<alerts-${mailId}@sjer.red>`,
    deliveryId: "123e4567-e89b-42d3-a456-426614174000",
    createdAtNs: mailCreatedNs,
    sentAtNs: mailCreatedNs + 2_000_000_000n,
    canceledAtNs: null,
    canceledBy: null,
    cancellationReason: null,
    attemptCount: 1,
    lastError: null,
    occurrenceIds: [alertId],
    subject: "Warning: Storage volume is nearly full",
    htmlBody:
      "<!DOCTYPE html><html><body><p>Storage volume is nearly full</p></body></html>",
    plainBody: "Warning: Storage volume is nearly full\n",
  });
}
