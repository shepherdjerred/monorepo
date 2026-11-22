import { Temporal } from "@js-temporal/polyfill";
import { OPS_MAILBOXES } from "@shepherdjerred/ops-model/email/mailbox.ts";
import { ReportEnvelopeV1Schema } from "@shepherdjerred/ops-model/reports/report-envelope.ts";
import { describe, expect, it } from "vitest";

import {
  countActionableFindings,
  countFailedChecks,
  renderReportEnvelopeEmail,
} from "#domain/reports/report-email";
import {
  buildPacificDayWindow,
  buildScheduleDays,
  computeScheduleFreshness,
  filterAndSortFeedItems,
  needsOperatorReview,
} from "#domain/reports/report-overview";
import { ReportsFeedQuerySchema } from "#shared/reports-schema";

describe("reports domain helpers", () => {
  it("computes 30-day Pacific strips and ranks day states by operator priority", () => {
    const now = Temporal.Instant.from("2026-11-22T18:00:00Z"); // 2026-11-22 10:00 PST
    const dates = buildPacificDayWindow(now);
    expect(dates).toHaveLength(30);
    expect(dates[0]).toBe("2026-10-24");
    expect(dates[29]).toBe("2026-11-22");

    const days = buildScheduleDays(dates, [
      {
        completedAtNs: now.subtract({ hours: 2 }).epochNanoseconds,
        verdict: "clear",
        deliveryStatus: "skipped",
      },
      {
        completedAtNs: now.subtract({ hours: 1 }).epochNanoseconds,
        verdict: "changed",
        deliveryStatus: "sent",
        prUrl: "https://github.com/shepherdjerred/monorepo/pull/3071",
      },
      {
        completedAtNs: now.subtract({ hours: 25 }).epochNanoseconds,
        verdict: "clear",
        deliveryStatus: "skipped",
      },
      {
        completedAtNs: now.subtract({ hours: 49 }).epochNanoseconds,
        verdict: "clear",
        deliveryStatus: "failed",
      },
    ]);

    expect(days.at(-1)).toEqual({
      date: "2026-11-22",
      state: "changed",
      runCount: 2,
      prUrl: "https://github.com/shepherdjerred/monorepo/pull/3071",
    });
    expect(days.at(-2)).toEqual({
      date: "2026-11-21",
      state: "quiet-clear",
      runCount: 1,
    });
    expect(days.at(-3)).toEqual({
      date: "2026-11-20",
      state: "failed",
      runCount: 1,
    });
    expect(days[0]).toEqual({
      date: "2026-10-24",
      state: "none",
      runCount: 0,
    });
  });

  it("evaluates schedule freshness against cadenceHours + graceHours", () => {
    const nowNs = Temporal.Instant.from(
      "2026-11-22T18:00:00Z",
    ).epochNanoseconds;
    const schedule = { cadenceHours: 24, graceHours: 2 };
    expect(computeScheduleFreshness(schedule, null, nowNs)).toBe("empty");
    expect(
      computeScheduleFreshness(
        schedule,
        nowNs - 25n * 3_600_000_000_000n,
        nowNs,
      ),
    ).toBe("fresh");
    expect(
      computeScheduleFreshness(
        schedule,
        nowNs - 27n * 3_600_000_000_000n,
        nowNs,
      ),
    ).toBe("stale");
  });
});

describe("reports email rendering and feed filtering", () => {
  it("counts actionable findings, failed checks, and renders fallback HTML and plain text", () => {
    const report = ReportEnvelopeV1Schema.parse({
      schemaVersion: 1,
      reportRunId: "homelab-audit:run-42",
      reportType: "homelab-audit",
      title: "Daily homelab audit",
      scheduleId: "homelab-audit-daily",
      startedAt: "2026-11-22T14:30:00Z",
      completedAt: "2026-11-22T14:31:00Z",
      execution: "complete",
      verdict: "attention",
      headline: "1 degraded workload detected.",
      checks: [
        {
          id: "pods",
          label: "Pod health",
          required: true,
          status: "failed",
          summary: "1 pod CrashLoopBackOff",
          evidenceReceiptIds: ["r1"],
        },
        {
          id: "nodes",
          label: "Node readiness",
          required: true,
          status: "passed",
          summary: "3 Ready",
          evidenceReceiptIds: ["r1"],
        },
      ],
      evidence: [
        {
          id: "r1",
          source: "kubectl",
          observedAt: "2026-11-22T14:30:30Z",
          status: "success",
        },
      ],
      findings: [
        {
          id: "f1",
          state: "active",
          severity: "warning",
          summary: "scout-beta pod restarting",
          evidenceReceiptIds: ["r1"],
        },
        {
          id: "f2",
          state: "recovered",
          severity: "critical",
          summary: "Recovered alert",
          evidenceReceiptIds: ["r1"],
        },
        {
          id: "f3",
          severity: "info",
          summary: "Informational note",
          evidenceReceiptIds: ["r1"],
        },
      ],
      limitations: [],
      actions: ["Inspect scout-beta pod logs."],
      provenance: {
        workflowId: "homelab-audit-daily-42",
        runId: "run-42",
      },
    });

    expect(countActionableFindings(report.findings)).toBe(1);
    expect(countFailedChecks(report.checks)).toBe(1);
    const rendered = renderReportEnvelopeEmail(report, "Homelab Check");
    expect(rendered.htmlBody).toContain("<!DOCTYPE html>");
    expect(rendered.htmlBody).toContain(
      "https://hub.tailnet-1a49.ts.net/reports/runs/homelab-audit%3Arun-42",
    );
    expect(rendered.plainBody).toContain("scout-beta pod restarting");
    expect(rendered.plainBody).not.toContain("Recovered alert");

    expect(
      needsOperatorReview({
        verdict: "changed",
        deliveryStatus: "sent",
        prUrl: "https://github.com/shepherdjerred/monorepo/pull/1",
        autoMergeEnabled: true,
      }),
    ).toBe(false);
    expect(
      needsOperatorReview({
        verdict: "changed",
        deliveryStatus: "sent",
        prUrl: "https://github.com/shepherdjerred/monorepo/pull/2",
        autoMergeEnabled: false,
      }),
    ).toBe(true);
    expect(
      needsOperatorReview({
        execution: "failed",
        verdict: "inconclusive",
        deliveryStatus: "sent",
      }),
    ).toBe(true);
  });

  it("filters feed items by tab, mailbox, verdict, delivery, PR presence, and search query", () => {
    const items = [
      {
        kind: "temporal-report" as const,
        id: "r1",
        href: "/reports/runs/r1",
        occurredAt: "2026-11-22T16:00:00Z",
        occurredAtNs: 200n,
        scheduleId: "scout-queue-windows-daily",
        eyebrow: "Scout Automation",
        title: "Scout queue windows watcher",
        subject: "Scout: Queue window updated",
        headline: "Opened PR #3090",
        mailboxFrom: OPS_MAILBOXES.reports.scout.from,
        mailboxTo: OPS_MAILBOXES.reports.scout.to,
        verdict: "changed" as const,
        deliveryStatus: "sent" as const,
        prUrl: "https://github.com/shepherdjerred/monorepo/pull/3090",
        autoMergeEnabled: false,
        findingCount: 1,
        actionableFindingCount: 0,
        failedCheckCount: 0,
      },
      {
        kind: "incident-mail" as const,
        id: "m1",
        href: "/reports/mail/m1",
        occurredAt: "2026-11-22T17:00:00Z",
        occurredAtNs: 300n,
        scheduleId: null,
        eyebrow: "Hub Alerts",
        title: "Incident email (1 alert)",
        subject: "Critical: Disk full",
        headline: "Critical: Disk full",
        mailboxFrom: OPS_MAILBOXES.alerts.from,
        mailboxTo: OPS_MAILBOXES.alerts.to,
        verdict: "attention" as const,
        deliveryStatus: "canceled" as const,
        findingCount: 1,
        actionableFindingCount: 1,
        failedCheckCount: 0,
      },
    ];

    expect(
      filterAndSortFeedItems(
        items,
        ReportsFeedQuerySchema.parse({ tab: "all" }),
      ).map((item) => item.id),
    ).toEqual(["m1", "r1"]);

    expect(
      filterAndSortFeedItems(
        items,
        ReportsFeedQuerySchema.parse({
          tab: "reports",
          mailbox: "scout@sjer.red",
          hasPr: "1",
          q: "3090",
        }),
      ).map((item) => item.id),
    ).toEqual(["r1"]);

    expect(
      filterAndSortFeedItems(
        items,
        ReportsFeedQuerySchema.parse({
          tab: "incidents",
          delivery: "canceled",
        }),
      ).map((item) => item.id),
    ).toEqual(["m1"]);
  });
});
