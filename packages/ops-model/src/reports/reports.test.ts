import { describe, expect, test } from "vitest";
import {
  OPS_MAILBOXES,
  reportMailboxForType,
} from "@shepherdjerred/ops-model/email/mailbox.ts";
import {
  ReportEnvelopeV1Schema,
  ReportRemediationV1Schema,
  type ReportEnvelopeInputV1,
} from "./report-envelope.ts";
import {
  ReportRunIngestBatchSchema,
  ReportRunIngestItemSchema,
} from "./report-ingest.ts";
import {
  DAILY_CHANGED_TEMPORAL_FAMILIES,
  OPS_DIGEST_SCHEDULES,
  RECURRING_REPORT_SCHEDULES,
  RecurringReportScheduleSchema,
  TEMPORAL_REPORT_SCHEDULES,
  findRecurringSchedule,
  usesDailyChangedTemporalPolicy,
} from "./schedule-catalog.ts";

function validReportInput(): ReportEnvelopeInputV1 {
  return {
    schemaVersion: 1,
    reportRunId: "link-rot-scan:run-1",
    reportType: "link-rot-scan",
    title: "Weekly link-rot scan",
    scheduleId: "link-rot-scan-weekly",
    startedAt: "2026-11-22T17:00:00.000Z",
    completedAt: "2026-11-22T17:01:00.000Z",
    execution: "complete",
    verdict: "clear",
    headline: "All checked links returned HTTP 200.",
    checks: [
      {
        id: "links",
        label: "Repository URL scan",
        required: true,
        status: "passed",
        summary: "Verified 142 URLs.",
        evidenceReceiptIds: ["scan-receipt"],
      },
    ],
    evidence: [
      {
        id: "scan-receipt",
        source: "link-scanner",
        origin: "declared-collector",
        semanticStatus: "passed",
        observedAt: "2026-11-22T17:00:45.000Z",
        status: "success",
        command: "bun scripts/check-links.ts",
        exitCode: 0,
        contentSha256:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    ],
    findings: [],
    limitations: [],
    actions: [],
    provenance: {
      workflowId: "link-rot-scan-weekly-2026-11-22",
      runId: "run-1",
      repoSha: "deadbeef",
    },
  };
}

describe("ReportEnvelopeV1Schema and ReportRemediationV1Schema", () => {
  test("parses valid envelopes with and without remediation metadata", () => {
    const plain = ReportEnvelopeV1Schema.parse(validReportInput());
    expect(plain.remediation).toBeUndefined();

    const withRemediation = ReportEnvelopeV1Schema.parse({
      ...validReportInput(),
      verdict: "changed",
      remediation: {
        outcome: "pr-created",
        prUrl: "https://github.com/shepherdjerred/monorepo/pull/999",
        branchName: "auto/fix-link-rot-2026-11-22",
        commitSha: "cafebabe",
        autoMergeEnabled: true,
        resolvedCount: 3,
        unresolvedCount: 0,
        summary: "Updated three redirected documentation links.",
      },
    });
    expect(withRemediation.remediation).toEqual({
      outcome: "pr-created",
      prUrl: "https://github.com/shepherdjerred/monorepo/pull/999",
      branchName: "auto/fix-link-rot-2026-11-22",
      commitSha: "cafebabe",
      autoMergeEnabled: true,
      changedFiles: [],
      resolvedCount: 3,
      unresolvedCount: 0,
      summary: "Updated three redirected documentation links.",
    });
  });

  test("rejects non-http remediation PR URLs and negative counts", () => {
    expect(
      ReportRemediationV1Schema.safeParse({
        outcome: "pr-created",
        prUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);

    expect(
      ReportRemediationV1Schema.safeParse({
        outcome: "partial",
        resolvedCount: -1,
      }).success,
    ).toBe(false);
  });

  test("enforces timestamp ordering and 80-word synthesis limit", () => {
    expect(() =>
      ReportEnvelopeV1Schema.parse({
        ...validReportInput(),
        startedAt: "2026-11-22T17:02:00.000Z",
        completedAt: "2026-11-22T17:01:00.000Z",
      }),
    ).toThrow("completedAt must not be earlier than startedAt");

    expect(
      ReportEnvelopeV1Schema.parse({
        ...validReportInput(),
        synthesis: Array.from({ length: 80 }, () => "word").join(" "),
      }).synthesis,
    ).toBeDefined();

    expect(() =>
      ReportEnvelopeV1Schema.parse({
        ...validReportInput(),
        synthesis: Array.from({ length: 81 }, () => "word").join(" "),
      }),
    ).toThrow("synthesis must contain at most 80 words");
  });

  test("enforces unique check and evidence receipt IDs", () => {
    const base = validReportInput();
    const firstReceipt = base.evidence[0];
    const firstCheck = base.checks[0];
    if (firstReceipt === undefined || firstCheck === undefined) {
      throw new TypeError("expected report fixtures");
    }

    expect(() =>
      ReportEnvelopeV1Schema.parse({
        ...base,
        evidence: [firstReceipt, firstReceipt],
      }),
    ).toThrow("evidence receipt ids must be unique");

    expect(() =>
      ReportEnvelopeV1Schema.parse({
        ...base,
        checks: [firstCheck, firstCheck],
      }),
    ).toThrow("check ids must be unique");
  });

  test("enforces valid evidence references and required check coverage invariants", () => {
    const base = validReportInput();
    const firstReceipt = base.evidence[0];
    const firstCheck = base.checks[0];
    if (firstReceipt === undefined || firstCheck === undefined) {
      throw new TypeError("expected report fixtures");
    }

    expect(() =>
      ReportEnvelopeV1Schema.parse({
        ...base,
        checks: [{ ...firstCheck, evidenceReceiptIds: ["missing-id"] }],
      }),
    ).toThrow("unknown evidence receipt: missing-id");

    expect(() =>
      ReportEnvelopeV1Schema.parse({
        ...base,
        verdict: "attention",
        findings: [
          {
            severity: "warning",
            summary: "Broken link",
            evidenceReceiptIds: ["missing-finding-receipt"],
          },
        ],
      }),
    ).toThrow("unknown evidence receipt: missing-finding-receipt");

    expect(() =>
      ReportEnvelopeV1Schema.parse({
        ...base,
        evidence: [{ ...firstReceipt, status: "failure" }],
      }),
    ).toThrow("a passed check needs successful evidence");

    expect(() =>
      ReportEnvelopeV1Schema.parse({
        ...base,
        verdict: "attention",
        checks: [{ ...firstCheck, status: "failed" }],
        evidence: [{ ...firstReceipt, status: "failure" }],
      }),
    ).toThrow(
      "complete execution requires successful evidence coverage for every required check",
    );

    expect(() =>
      ReportEnvelopeV1Schema.parse({
        ...base,
        checks: [{ ...firstCheck, status: "skipped", evidenceReceiptIds: [] }],
      }),
    ).toThrow("clear verdict requires complete required-check coverage");

    // Failed gate with successful evidence collection is a complete execution with non-clear verdict.
    expect(
      ReportEnvelopeV1Schema.parse({
        ...base,
        verdict: "attention",
        checks: [{ ...firstCheck, status: "failed" }],
      }),
    ).toMatchObject({
      execution: "complete",
      verdict: "attention",
    });
  });
});

describe("ReportRunIngestBatchSchema", () => {
  test("validates sent and skipped Hub report ingest batches", () => {
    const batch = ReportRunIngestBatchSchema.parse({
      items: [
        {
          report: validReportInput(),
          subject: "Link check: All links reachable",
          eyebrow: "Link Check",
          mailboxFrom: OPS_MAILBOXES.reports.general.from,
          mailboxTo: OPS_MAILBOXES.reports.general.to,
          deliveryStatus: "sent",
          messageId: "msg-123",
          acceptedAt: "2026-11-22T17:01:02.000Z",
          htmlBody: "<!DOCTYPE html><html><body>ok</body></html>",
        },
        {
          report: {
            ...validReportInput(),
            reportRunId: "homelab-audit:run-2",
            reportType: "homelab-audit",
            scheduleId: "homelab-audit-daily",
          },
          subject: "Homelab check: All clear",
          eyebrow: "Homelab Check",
          mailboxFrom: OPS_MAILBOXES.reports.ops.from,
          mailboxTo: OPS_MAILBOXES.reports.ops.to,
          deliveryStatus: "skipped",
          skipReason: "unchanged",
        },
      ],
    });
    expect(batch.items).toHaveLength(2);
  });

  test("rejects empty batches, oversized batches, and malformed addresses", () => {
    expect(ReportRunIngestBatchSchema.safeParse({ items: [] }).success).toBe(
      false,
    );

    const validItem = ReportRunIngestItemSchema.parse({
      report: validReportInput(),
      subject: "Link check: All links reachable",
      eyebrow: "Link Check",
      mailboxFrom: OPS_MAILBOXES.reports.general.from,
      mailboxTo: OPS_MAILBOXES.reports.general.to,
      deliveryStatus: "pending",
    });
    expect(
      ReportRunIngestBatchSchema.safeParse({
        items: Array.from({ length: 51 }, () => validItem),
      }).success,
    ).toBe(false);

    expect(
      ReportRunIngestItemSchema.safeParse({
        ...validItem,
        mailboxTo: "not-an-email",
      }).success,
    ).toBe(false);
  });
});

describe("RECURRING_REPORT_SCHEDULES catalog", () => {
  test("declares all 13 recurring streams with schema-valid metadata and aligned mailboxes", () => {
    expect(RECURRING_REPORT_SCHEDULES).toHaveLength(13);
    expect(TEMPORAL_REPORT_SCHEDULES).toHaveLength(11);
    expect(OPS_DIGEST_SCHEDULES).toHaveLength(2);

    const ids = RECURRING_REPORT_SCHEDULES.map(
      (schedule) => schedule.scheduleId,
    );
    expect(new Set(ids).size).toBe(13);

    for (const schedule of RECURRING_REPORT_SCHEDULES) {
      expect(RecurringReportScheduleSchema.parse(schedule)).toEqual(schedule);
      expect(findRecurringSchedule(schedule.scheduleId)).toEqual(schedule);
    }
    expect(findRecurringSchedule("nonexistent-schedule")).toBeUndefined();

    for (const schedule of TEMPORAL_REPORT_SCHEDULES) {
      expect(schedule.mailbox).toEqual(
        reportMailboxForType(schedule.reportType),
      );
    }
    for (const digest of OPS_DIGEST_SCHEDULES) {
      expect(digest.mailbox).toEqual(OPS_MAILBOXES.digests);
      expect(digest.automationMode).toBe("digest");
    }
  });

  test("derives exact daily-changed Temporal schedule families", () => {
    expect(DAILY_CHANGED_TEMPORAL_FAMILIES).toEqual({
      "the-storm-promotion-daily": "storm-promotion",
      "homelab-audit-daily": "homelab-audit",
      "scout-data-dragon-version-check": "scout-data-dragon",
      "scout-queue-windows-daily": "scout-queue-windows",
    });

    expect(
      usesDailyChangedTemporalPolicy({
        scheduleId: "scout-data-dragon-version-check",
        reportType: "scout-data-dragon",
      }),
    ).toBe(true);
    expect(
      usesDailyChangedTemporalPolicy({
        scheduleId: "scout-data-dragon-weekly-refresh",
        reportType: "scout-data-dragon",
      }),
    ).toBe(false);
    expect(
      usesDailyChangedTemporalPolicy({
        scheduleId: "ops-digest-daily",
        reportType: "ops-digest-daily",
      }),
    ).toBe(false);
  });
});
