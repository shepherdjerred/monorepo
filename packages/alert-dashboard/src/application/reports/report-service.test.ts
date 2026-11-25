import { Temporal } from "@js-temporal/polyfill";
import { RECURRING_REPORT_SCHEDULES } from "@shepherdjerred/ops-model/reports/schedule-catalog.ts";
import { describe, expect, it } from "vitest";

import { digestPeriodKey } from "#domain/ops-period";
import { fixedClock } from "#shared/time";
import { createOpsFixture } from "#test-fixtures/ops-services";
import { fixtureOpsIngest } from "#test-fixtures/ops-snapshot";
import { seedReportFixtures } from "#test-fixtures/reports-fixture";

const NOW = "2026-11-22T18:00:00Z";

async function setup() {
  const now = Temporal.Instant.from(NOW);
  const fixture = createOpsFixture(fixedClock(NOW));
  await fixture.ops.ingest(
    JSON.stringify(fixtureOpsIngest(now.subtract({ minutes: 2 }).toString())),
  );
  await seedReportFixtures({
    reportsRepository: fixture.reportsRepository,
    opsRepository: fixture.repository,
    now,
  });
  return { fixture, now };
}

describe("ReportService", () => {
  it("computes overview KPIs and enriches all 14 recurring schedules", async () => {
    const { fixture } = await setup();
    const overview = await fixture.reports.overview();

    expect(overview.schedules).toHaveLength(RECURRING_REPORT_SCHEDULES.length);
    expect(overview.kpis.totalSchedules).toBe(14);
    expect(overview.kpis.freshSchedules).toBe(14);
    expect(overview.kpis.autoPrCount7d).toBe(2);
    expect(overview.kpis.quietSkips7d).toBeGreaterThanOrEqual(5);
    // `main-vuln-scan-weekly` has verdict="attention" and autoMergeEnabled=false.
    expect(overview.kpis.needsReviewCount).toBe(1);

    const linkRot = overview.schedules.find(
      (s) => s.scheduleId === "link-rot-scan-weekly",
    );
    expect(linkRot?.freshness).toBe("fresh");
    expect(linkRot?.latestRun).toMatchObject({
      id: "link-rot-scan-weekly:latest",
      verdict: "changed",
      autoMergeEnabled: true,
    });
    expect(linkRot?.days).toHaveLength(30);
    expect(linkRot?.days.at(-1)?.state).toBe("changed");

    const dailyDigest = overview.schedules.find(
      (s) => s.scheduleId === "ops-digest-daily",
    );
    expect(dailyDigest?.freshness).toBe("fresh");
    expect(dailyDigest?.latestRun).toMatchObject({
      verdict: "clear",
      deliveryStatus: "skipped",
      skipReason: "unchanged-clear",
    });
  });

  it("serves unified feed items across reports, digests, agent-tasks, and incidents", async () => {
    const { fixture } = await setup();

    const all = await fixture.reports.feed({});
    const kinds = new Set(all.items.map((item) => item.kind));
    expect(kinds).toEqual(
      new Set(["temporal-report", "ops-digest", "agent-task", "incident-mail"]),
    );

    const agentTasks = await fixture.reports.feed({ tab: "agent-tasks" });
    expect(agentTasks.items).toHaveLength(1);
    expect(agentTasks.items[0]?.id).toBe("agent-task:compat-check-1");

    const incidents = await fixture.reports.feed({ tab: "incidents" });
    expect(incidents.items).toHaveLength(1);
    expect(incidents.items[0]?.deliveryStatus).toBe("sent");
  });

  it("returns report run detail with derived HTML/plain text and sibling runs", async () => {
    const { fixture } = await setup();
    const detail = await fixture.reports.runDetail(
      "homelab-audit-daily:latest",
    );
    expect(detail).not.toBeNull();
    expect(detail?.deliveryStatus).toBe("skipped");
    expect(detail?.skipReason).toBe("unchanged");
    expect(detail?.htmlBody).toContain("<!DOCTYPE html>");
    expect(detail?.plainBody).toContain("Daily homelab audit");
    expect(detail?.recentRuns).toHaveLength(1);

    expect(await fixture.reports.runDetail("missing-run")).toBeNull();
  });

  it("serves stored digest archives, live preview for the current period, and null for missing historical periods", async () => {
    const { fixture, now } = await setup();
    const todayKey = digestPeriodKey("daily", now);
    const yesterdayKey = digestPeriodKey("daily", now.subtract({ hours: 24 }));

    const livePreview = await fixture.reports.digestDetail("daily", todayKey);
    expect(livePreview?.status).toBe("live-preview");
    expect(livePreview?.sentAt).toBeNull();
    expect(livePreview?.htmlBody).toContain("<!DOCTYPE html>");

    const archivedSkipped = await fixture.reports.digestDetail(
      "daily",
      yesterdayKey,
    );
    expect(archivedSkipped?.status).toBe("skipped");
    expect(archivedSkipped?.skipReason).toBe("unchanged-clear");

    expect(
      await fixture.reports.digestDetail("daily", "2020-01-01"),
    ).toBeNull();
  });

  it("serves incident mail detail with linked occurrences", async () => {
    const { fixture } = await setup();
    const detail = await fixture.reports.incidentDetail(
      "123e4567-e89b-42d3-a456-426614174099",
    );
    expect(detail).not.toBeNull();
    expect(detail?.status).toBe("sent");
    expect(detail?.occurrences).toHaveLength(1);
    expect(detail?.occurrences[0]?.alertname).toBe("DiskFull");

    expect(await fixture.reports.incidentDetail("missing-mail")).toBeNull();
  });
});

describe("ReportService feed pagination", () => {
  it("finds filtered feed matches even behind >300 newer clear runs", async () => {
    const { fixture, now } = await setup();
    const olderTargetCompleted = now.subtract({ hours: 20 * 24 });
    const sampleCheck = {
      id: "check-1",
      label: "Audit check",
      required: true,
      status: "passed" as const,
      summary: "Checked state.",
      evidenceReceiptIds: ["receipt-1"],
    };
    const sampleEvidence = {
      id: "receipt-1",
      source: "homelab-audit",
      origin: "declared-collector" as const,
      semanticStatus: "passed" as const,
      observedAt: olderTargetCompleted.toString(),
      status: "success" as const,
      exitCode: 0,
    };
    const bulkItems = [
      {
        report: {
          schemaVersion: 1 as const,
          reportRunId: "deep-history:needle-run",
          reportType: "homelab-audit",
          title: "Daily homelab audit",
          scheduleId: "homelab-audit-daily",
          startedAt: olderTargetCompleted.subtract({ seconds: 30 }).toString(),
          completedAt: olderTargetCompleted.toString(),
          execution: "complete" as const,
          verdict: "attention" as const,
          headline: "Deep historical certificate expiry needle",
          checks: [{ ...sampleCheck, status: "failed" as const }],
          evidence: [{ ...sampleEvidence, semanticStatus: "failed" as const }],
          findings: [],
          limitations: [],
          actions: [],
          remediation: {
            outcome: "pr-created" as const,
            prUrl: "https://github.com/shepherdjerred/monorepo/pull/9999",
            autoMergeEnabled: false,
            changedFiles: ["packages/homelab/README.md"],
            resolvedCount: 1,
            unresolvedCount: 0,
            summary: "Opened historical remediation PR.",
          },
          provenance: {
            workflowId: "wf-deep-needle",
            runId: "run-deep-needle",
          },
        },
        subject: "Homelab check: Historical certificate needle",
        eyebrow: "Homelab Check",
        mailboxFrom: "Homelab Audit <ops@sjer.red>",
        mailboxTo: "ops@sjer.red",
        deliveryStatus: "failed" as const,
      },
      ...Array.from({ length: 320 }, (_, index) => {
        const completed = now.subtract({ minutes: index + 1 });
        return {
          report: {
            schemaVersion: 1 as const,
            reportRunId: `homelab-audit-daily:bulk-${String(index)}`,
            reportType: "homelab-audit",
            title: "Daily homelab audit",
            scheduleId: "homelab-audit-daily",
            startedAt: completed.subtract({ seconds: 10 }).toString(),
            completedAt: completed.toString(),
            execution: "complete" as const,
            verdict: "clear" as const,
            headline: "All clear",
            checks: [sampleCheck],
            evidence: [sampleEvidence],
            findings: [],
            limitations: [],
            actions: [],
            provenance: {
              workflowId: `wf-bulk-${String(index)}`,
              runId: `run-bulk-${String(index)}`,
            },
          },
          subject: "Homelab check: All clear",
          eyebrow: "Homelab Check",
          mailboxFrom: "Homelab Audit <ops@sjer.red>",
          mailboxTo: "ops@sjer.red",
          deliveryStatus: "skipped" as const,
          skipReason: "unchanged" as const,
        };
      }),
    ];
    for (let offset = 0; offset < bulkItems.length; offset += 50) {
      await fixture.reports.ingest(
        JSON.stringify({ items: bulkItems.slice(offset, offset + 50) }),
      );
    }

    const bySearch = await fixture.reports.feed({
      q: "certificate expiry needle",
      limit: 20,
    });
    expect(bySearch.items.map((item) => item.id)).toContain(
      "deep-history:needle-run",
    );

    const byDelivery = await fixture.reports.feed({
      delivery: "failed",
      limit: 20,
    });
    expect(byDelivery.items.map((item) => item.id)).toContain(
      "deep-history:needle-run",
    );

    const byHasPr = await fixture.reports.feed({
      hasPr: "1",
      limit: 20,
    });
    expect(byHasPr.items.map((item) => item.id)).toContain(
      "deep-history:needle-run",
    );

    const oldMailCreatedNs = now.subtract({ hours: 48 }).epochNanoseconds;
    fixture.reportsRepository.incidentMails.set("retried-mail-needle", {
      id: "retried-mail-needle",
      messageId: "<retried-mail-needle@sjer.red>",
      deliveryId: "delivery-retried",
      createdAtNs: oldMailCreatedNs,
      sentAtNs: now.epochNanoseconds,
      canceledAtNs: null,
      canceledBy: null,
      cancellationReason: null,
      attemptCount: 3,
      lastError: null,
      occurrenceIds: [],
      subject: "Warning: Retried incident email sent after backlog",
      htmlBody: "<!DOCTYPE html><html><body>Retried</body></html>",
      plainBody: "Retried",
    });
    for (let index = 0; index < 120; index += 1) {
      const id = `newer-pending-mail-${String(index)}`;
      fixture.reportsRepository.incidentMails.set(id, {
        id,
        messageId: `<${id}@sjer.red>`,
        deliveryId: `delivery-${String(index)}`,
        createdAtNs: now.subtract({ minutes: index + 1 }).epochNanoseconds,
        sentAtNs: null,
        canceledAtNs: null,
        canceledBy: null,
        cancellationReason: null,
        attemptCount: 0,
        lastError: null,
        occurrenceIds: [],
        subject: `Pending outbox ${String(index)}`,
        htmlBody: "<!DOCTYPE html><html><body>Pending</body></html>",
        plainBody: "Pending",
      });
    }
    const recentIncidents = await fixture.reports.feed({
      tab: "incidents",
      limit: 5,
    });
    expect(recentIncidents.items[0]?.id).toBe("retried-mail-needle");
  });
});
