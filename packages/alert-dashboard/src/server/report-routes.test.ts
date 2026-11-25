import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import { AlertService } from "#application/alert-service";
import { digestPeriodKey } from "#domain/ops-period";
import { createApp } from "#server/app";
import { ChangeBus, type Change } from "#server/change-bus";
import { Metrics } from "#server/metrics";
import {
  DigestRunDetailSchema,
  IncidentMailDetailSchema,
  ReportRunDetailSchema,
  ReportRunIngestResponseSchema,
  ReportsFeedResponseSchema,
  ReportsOverviewResponseSchema,
} from "#shared/reports-schema";
import { fixedClock } from "#shared/time";
import { readinessOnlyLedger, unexpected } from "#test-fixtures/alert-ledger";
import { createOpsFixture } from "#test-fixtures/ops-services";
import { fixtureOpsIngest } from "#test-fixtures/ops-snapshot";
import {
  fixtureReportIngestBatch,
  seedReportFixtures,
} from "#test-fixtures/reports-fixture";

const NOW = "2026-11-22T18:00:00Z";
const TOKEN = "ops-ingest-token-with-at-least-32-chars";

async function setup(seed = true) {
  const now = Temporal.Instant.from(NOW);
  const clock = fixedClock(NOW);
  const fixture = createOpsFixture(clock);
  await fixture.ops.ingest(
    JSON.stringify(fixtureOpsIngest(now.subtract({ minutes: 1 }).toString())),
  );
  if (seed) {
    await seedReportFixtures({
      reportsRepository: fixture.reportsRepository,
      opsRepository: fixture.repository,
      now,
    });
  }
  const changes = new ChangeBus();
  const published: Change["reason"][] = [];
  changes.subscribe((change) => {
    published.push(change.reason);
  });
  const metrics = new Metrics();
  const app = createApp({
    service: new AlertService({
      repository: readinessOnlyLedger(),
      alertmanager: { activeAlerts: unexpected },
      mail: { send: unexpected },
      previews: { previews: unexpected, health: unexpected },
      clock,
      emailEnabled: false,
    }),
    changes,
    metrics,
    webhookToken: "alertmanager-webhook-token-32-characters",
    ops: fixture.ops,
    digests: fixture.digests,
    reports: fixture.reports,
    opsIngestToken: TOKEN,
  });
  return { app, fixture, metrics, published, now };
}

describe("report routes", () => {
  it("authenticates, validates, upserts, and publishes metrics + change events on POST /internal/v1/reports/runs", async () => {
    const { app, metrics, published, now } = await setup(false);
    const batch = fixtureReportIngestBatch(now);

    const unauth = await app.request("/internal/v1/reports/runs", {
      method: "POST",
      body: JSON.stringify(batch),
    });
    expect(unauth.status).toBe(401);

    const invalid = await app.request("/internal/v1/reports/runs", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ items: [] }),
    });
    expect(invalid.status).toBe(400);

    const accepted = await app.request("/internal/v1/reports/runs", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(batch),
    });
    expect(accepted.status).toBe(202);
    expect(ReportRunIngestResponseSchema.parse(await accepted.json())).toEqual({
      accepted: batch.items.length,
    });
    expect(published).toEqual(["reports"]);

    const renderedMetrics = metrics.render();
    expect(renderedMetrics).toContain(
      'alert_dashboard_report_ingest_total{result="unauthorized"} 1',
    );
    expect(renderedMetrics).toContain(
      'alert_dashboard_report_ingest_total{result="rejected"} 1',
    );
    expect(renderedMetrics).toContain(
      'alert_dashboard_report_ingest_total{result="accepted"} 1',
    );
  });

  it("serves overview, feed, run detail, digest detail, and incident detail routes with 404/400 boundaries", async () => {
    const { app, now } = await setup(true);

    const overviewRes = await app.request("/api/v1/reports/overview");
    expect(overviewRes.status).toBe(200);
    const overview = ReportsOverviewResponseSchema.parse(
      await overviewRes.json(),
    );
    expect(overview.schedules).toHaveLength(14);

    const feedRes = await app.request(
      "/api/v1/reports/feed?tab=reports&hasPr=1&q=&scheduleId=",
    );
    expect(feedRes.status).toBe(200);
    const feed = ReportsFeedResponseSchema.parse(await feedRes.json());
    expect(feed.items).toHaveLength(2);
    expect(feed.items.every((item) => item.prUrl !== undefined)).toBe(true);

    const badFeedRes = await app.request("/api/v1/reports/feed?tab=nope");
    expect(badFeedRes.status).toBe(400);

    const runRes = await app.request(
      `/api/v1/reports/runs/${encodeURIComponent("link-rot-scan-weekly:latest")}`,
    );
    expect(runRes.status).toBe(200);
    const runDetail = ReportRunDetailSchema.parse(await runRes.json());
    expect(runDetail.report.remediation?.autoMergeEnabled).toBe(true);

    const missingRunRes = await app.request(
      "/api/v1/reports/runs/does-not-exist",
    );
    expect(missingRunRes.status).toBe(404);

    const todayKey = digestPeriodKey("daily", now);
    const liveDigestRes = await app.request(
      `/api/v1/reports/digests/daily/${todayKey}`,
    );
    expect(liveDigestRes.status).toBe(200);
    expect(DigestRunDetailSchema.parse(await liveDigestRes.json()).status).toBe(
      "live-preview",
    );

    const missingDigestRes = await app.request(
      "/api/v1/reports/digests/daily/1999-01-01",
    );
    expect(missingDigestRes.status).toBe(404);

    const badDigestKindRes = await app.request(
      "/api/v1/reports/digests/monthly/2026-11",
    );
    expect(badDigestKindRes.status).toBe(400);

    const incidentRes = await app.request(
      "/api/v1/reports/incidents/123e4567-e89b-42d3-a456-426614174099",
    );
    expect(incidentRes.status).toBe(200);
    expect(
      IncidentMailDetailSchema.parse(await incidentRes.json()).occurrences,
    ).toHaveLength(1);

    const missingIncidentRes = await app.request(
      "/api/v1/reports/incidents/missing-outbox-id",
    );
    expect(missingIncidentRes.status).toBe(404);
  });
});
