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
  it("computes overview KPIs and enriches all 13 recurring schedules", async () => {
    const { fixture } = await setup();
    const overview = await fixture.reports.overview();

    expect(overview.schedules).toHaveLength(RECURRING_REPORT_SCHEDULES.length);
    expect(overview.kpis.totalSchedules).toBe(13);
    expect(overview.kpis.freshSchedules).toBe(13);
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
