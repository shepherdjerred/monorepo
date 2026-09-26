import { describe, expect, it } from "vitest";
import { SnapshotResponseSchema } from "@shepherdjerred/ops-model/snapshot.ts";

import { AlertService } from "#application/alert-service";
import { createApp } from "#server/app";
import { ChangeBus } from "#server/change-bus";
import { Metrics } from "#server/metrics";
import {
  ChangeListResponseSchema,
  CursorResponseSchema,
  DigestReportSchema,
  DigestRunResponseSchema,
  OpsErrorSchema,
  SeriesResponseSchema,
  ServiceDetailSchema,
} from "#shared/ops-schema";
import { fixedClock } from "#shared/time";
import { fixtureOpsIngest } from "#test-fixtures/ops-snapshot";
import { readinessOnlyLedger, unexpected } from "#test-fixtures/alert-ledger";
import { createOpsFixture } from "#test-fixtures/ops-services";

const NOW = "2026-09-24T15:00:00Z";
const TOKEN = "ops-ingest-token-with-at-least-32-chars";

function setup(options: { digestEnabled?: boolean } = {}) {
  const clock = fixedClock(NOW);
  const ledger = readinessOnlyLedger();
  const fixture = createOpsFixture(clock, options);
  const metrics = new Metrics();
  const app = createApp({
    service: new AlertService({
      repository: ledger,
      alertmanager: { activeAlerts: unexpected },
      postal: { send: unexpected },
      previews: { previews: unexpected, health: unexpected },
      clock,
      emailEnabled: false,
    }),
    changes: new ChangeBus(),
    metrics,
    webhookToken: "alertmanager-webhook-token-32-characters",
    ops: fixture.ops,
    digests: fixture.digests,
    opsIngestToken: TOKEN,
  });
  const ingest = (body: string, token = TOKEN) =>
    app.request("/internal/v1/ops/snapshots", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body,
    });
  return { app, fixture, metrics, ingest };
}

const body = JSON.stringify(fixtureOpsIngest(NOW));

async function readJson(
  pending: Promise<Response> | Response,
): Promise<unknown> {
  const response = await pending;
  const parsed: unknown = await response.json();
  return parsed;
}

describe("ops ingest route", () => {
  it("rejects a missing or wrong bearer token without storing anything", async () => {
    const { app, fixture, metrics, ingest } = setup();
    const missing = await app.request("/internal/v1/ops/snapshots", {
      method: "POST",
      body,
    });
    expect(missing.status).toBe(401);
    const wrong = await ingest(body, `${TOKEN}x`);
    expect(wrong.status).toBe(401);
    expect(fixture.repository.snapshots).toHaveLength(0);
    expect(metrics.render()).toContain(
      'alert_dashboard_ops_ingest_total{result="unauthorized"} 2',
    );
  });

  it("returns 400 for invalid bodies and 202 for a valid snapshot", async () => {
    const { ingest, metrics } = setup();
    const invalid = await ingest(JSON.stringify({ snapshot: {}, changes: [] }));
    expect(invalid.status).toBe(400);
    const malformed = await ingest("{");
    expect(malformed.status).toBe(400);
    const accepted = await ingest(body);
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toMatchObject({ changesUpserted: 3 });
    const rendered = metrics.render();
    expect(rendered).toContain(
      'alert_dashboard_ops_ingest_total{result="accepted"} 1',
    );
    expect(rendered).toContain(
      'alert_dashboard_ops_ingest_total{result="rejected"} 2',
    );
  });
});

describe("ops read routes", () => {
  it("answers 503 with a typed body before the first snapshot", async () => {
    const { app } = setup();
    const response = await app.request("/api/v1/ops/snapshot");
    expect(response.status).toBe(503);
    expect(OpsErrorSchema.parse(await response.json()).code).toBe(
      "snapshot_unavailable",
    );
  });

  it("serves the snapshot, new-signal annotations, and the cursor round trip", async () => {
    const { app, ingest } = setup();
    await ingest(body);
    const plain = SnapshotResponseSchema.parse(
      await readJson(app.request("/api/v1/ops/snapshot")),
    );
    expect(plain.stale).toBe(false);
    expect(plain.newSignalIds).toEqual([]);
    const web = SnapshotResponseSchema.parse(
      await readJson(app.request("/api/v1/ops/snapshot?consumer=web")),
    );
    expect(web.newSignalIds.length).toBeGreaterThan(0);

    const put = await app.request("/api/v1/ops/cursor", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        consumer: "web",
        seenSignalIds: web.newSignalIds,
      }),
    });
    expect(put.status).toBe(200);
    expect(CursorResponseSchema.parse(await put.json()).seenCount).toBe(
      web.newSignalIds.length,
    );
    const after = SnapshotResponseSchema.parse(
      await readJson(app.request("/api/v1/ops/snapshot?consumer=web")),
    );
    expect(after.newSignalIds).toEqual([]);

    const badConsumer = await app.request("/api/v1/ops/snapshot?consumer=x");
    expect(badConsumer.status).toBe(400);
    const badCursor = await app.request("/api/v1/ops/cursor", {
      method: "PUT",
      body: "not json",
    });
    expect(badCursor.status).toBe(400);
  });

  it("filters changes and serves service detail", async () => {
    const { app, ingest } = setup();
    await ingest(body);
    const changes = ChangeListResponseSchema.parse(
      await readJson(
        app.request("/api/v1/ops/changes?service=scout-for-lol&limit=1"),
      ),
    );
    expect(changes.items.map((item) => item.kind)).toEqual(["sync"]);

    const detail = ServiceDetailSchema.parse(
      await readJson(app.request("/api/v1/ops/services/birmel")),
    );
    expect(detail.signals.map((signal) => signal.id)).toEqual([
      "bugsink:birmel:1882",
    ]);
    const missing = await app.request("/api/v1/ops/services/nope");
    expect(missing.status).toBe(404);
    expect(OpsErrorSchema.parse(await missing.json()).code).toBe(
      "service_not_found",
    );
  });

  it("serves named series presets and rejects anything else", async () => {
    const { app } = setup();
    const ok = await app.request(
      "/api/v1/ops/series?preset=prs-open&range=30d",
    );
    expect(ok.status).toBe(200);
    expect(SeriesResponseSchema.parse(await ok.json()).stepSeconds).toBe(
      4 * 3600,
    );
    const raw = await app.request(
      `/api/v1/ops/series?preset=${encodeURIComponent("up{job='x'}")}`,
    );
    expect(raw.status).toBe(400);
  });

  it("serves the weekly review report", async () => {
    const { app, ingest } = setup();
    await ingest(body);
    const review = DigestReportSchema.parse(
      await readJson(app.request("/api/v1/ops/review?kind=weekly")),
    );
    expect(review.kind).toBe("weekly");
    expect(review.trends.length).toBeGreaterThan(0);
  });
});

describe("digest route", () => {
  it("requires the bearer token and skips while the flag is off", async () => {
    const { app, metrics } = setup();
    const unauthorized = await app.request("/internal/v1/digests/daily", {
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);
    const response = await app.request("/internal/v1/digests/daily", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
    expect(DigestRunResponseSchema.parse(await response.json())).toEqual({
      kind: "daily",
      periodKey: "2026-09-24",
      status: "skipped",
      duplicate: false,
    });
    expect(metrics.render()).toContain(
      'alert_dashboard_ops_digest_total{kind="daily",result="skipped"} 1',
    );
    const unknownKind = await app.request("/internal/v1/digests/monthly", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(unknownKind.status).toBe(400);
  });

  it("sends once when enabled", async () => {
    const { app, fixture, ingest } = setup({ digestEnabled: true });
    await ingest(body);
    const send = () =>
      app.request("/internal/v1/digests/weekly", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      });
    expect(await readJson(send())).toMatchObject({ status: "sent" });
    expect(await readJson(send())).toMatchObject({ duplicate: true });
    expect(fixture.postal.sent).toHaveLength(1);
  });
});
