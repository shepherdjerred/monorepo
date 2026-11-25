import { describe, expect, it } from "vitest";
import { DigestRunResponseSchema } from "@shepherdjerred/ops-model/digest.ts";
import { SnapshotResponseSchema } from "@shepherdjerred/ops-model/snapshot.ts";

import { AlertService } from "#application/alert-service";
import { createApp } from "#server/app";
import { ChangeBus } from "#server/change-bus";
import { Metrics } from "#server/metrics";
import {
  ChangeListResponseSchema,
  CursorResponseSchema,
  DigestReportSchema,
  OpsErrorSchema,
  OpsFacetsResponseSchema,
  opsFacetResponseSchema,
  SeriesResponseSchema,
  ServiceDetailSchema,
} from "#shared/ops-schema";
import { fixedClock } from "#shared/time";
import { readinessOnlyLedger, unexpected } from "#test-fixtures/alert-ledger";
import { FIXTURE_OPS_FACETS } from "#test-fixtures/ops-facets";
import { createOpsFixture } from "#test-fixtures/ops-services";
import { fixtureOpsIngest } from "#test-fixtures/ops-snapshot";

const NOW = "2026-09-24T15:00:00Z";
const TOKEN = "ops-ingest-token-with-at-least-32-chars";

function setup() {
  const clock = fixedClock(NOW);
  const ledger = readinessOnlyLedger();
  const fixture = createOpsFixture(clock);
  const metrics = new Metrics();
  const app = createApp({
    service: new AlertService({
      repository: ledger,
      alertmanager: { activeAlerts: unexpected },
      mail: { send: unexpected },
      previews: { previews: unexpected, health: unexpected },
      clock,
      emailEnabled: false,
    }),
    changes: new ChangeBus(),
    metrics,
    webhookToken: "alertmanager-webhook-token-32-characters",
    ops: fixture.ops,
    digests: fixture.digests,
    reports: fixture.reports,
    opsIngestToken: TOKEN,
  });
  const ingest = (payload: string, token = TOKEN) =>
    app.request("/internal/v1/ops/snapshots", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: payload,
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
  it("answers 503 with a typed body before the first snapshot, while facets answer 200 empty", async () => {
    const { app } = setup();
    const response = await app.request("/api/v1/ops/snapshot");
    expect(response.status).toBe(503);
    expect(OpsErrorSchema.parse(await response.json()).code).toBe(
      "snapshot_unavailable",
    );

    const emptyFacets = await app.request("/api/v1/ops/facets");
    expect(emptyFacets.status).toBe(200);
    expect(OpsFacetsResponseSchema.parse(await emptyFacets.json())).toEqual({
      generatedAt: null,
      receivedAt: null,
      stale: false,
      facets: {},
    });

    const emptySingle = await app.request("/api/v1/ops/facets/github");
    expect(emptySingle.status).toBe(200);
    expect(
      opsFacetResponseSchema("github").parse(await emptySingle.json()),
    ).toEqual({
      key: "github",
      generatedAt: null,
      receivedAt: null,
      stale: false,
      data: null,
    });
  });

  it("serves all facets, single facets by key, and 400 on unknown facet keys", async () => {
    const { app, ingest } = setup();
    const withFacets = JSON.stringify({
      ...fixtureOpsIngest(NOW),
      facets: FIXTURE_OPS_FACETS,
    });
    const ingested = await ingest(withFacets);
    expect(ingested.status).toBe(202);

    const allResponse = await app.request("/api/v1/ops/facets");
    expect(allResponse.status).toBe(200);
    const all = OpsFacetsResponseSchema.parse(await allResponse.json());
    expect(all.stale).toBe(false);
    expect(all.facets.github?.openPrs).toHaveLength(4);
    expect(all.facets.posthog?.sites).toHaveLength(14);

    const singleResponse = await app.request("/api/v1/ops/facets/renovate");
    expect(singleResponse.status).toBe(200);
    const renovate = opsFacetResponseSchema("renovate").parse(
      await singleResponse.json(),
    );
    expect(renovate.data?.openPrCount).toBe(3);

    const unknown = await app.request("/api/v1/ops/facets/not-a-facet");
    expect(unknown.status).toBe(400);
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

  it("filters changes and serves service detail with Pyroscope profile links", async () => {
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
    expect(detail.links.map((link) => link.kind)).toContain("profiles");
    const missing = await app.request("/api/v1/ops/services/nope");
    expect(missing.status).toBe(404);
    expect(OpsErrorSchema.parse(await missing.json()).code).toBe(
      "service_not_found",
    );
  });

  it("serves named and targeted series presets and rejects invalid inputs", async () => {
    const { app, fixture } = setup();
    const ok = await app.request(
      "/api/v1/ops/series?preset=prs-open&range=30d",
    );
    expect(ok.status).toBe(200);
    expect(SeriesResponseSchema.parse(await ok.json()).stepSeconds).toBe(
      4 * 3600,
    );

    const targeted = await app.request(
      "/api/v1/ops/series?preset=namespace-cpu&range=24h&target=scout-prod",
    );
    expect(targeted.status).toBe(200);
    expect(fixture.series.requests.at(-1)?.promql).toContain(
      'namespace=~"scout-prod"',
    );

    const badTarget = await app.request(
      `/api/v1/ops/series?preset=namespace-cpu&target=${encodeURIComponent('scout"}')}`,
    );
    expect(badTarget.status).toBe(400);

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
  it("requires the bearer token and a known kind", async () => {
    const { app, fixture } = setup();
    const unauthorized = await app.request("/internal/v1/digests/daily", {
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);
    expect(fixture.mail.sent).toHaveLength(0);
    const unknownKind = await app.request("/internal/v1/digests/monthly", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(unknownKind.status).toBe(400);
  });

  it("sends once per period", async () => {
    const { app, fixture, ingest, metrics } = setup();
    await ingest(body);
    const send = () =>
      app.request("/internal/v1/digests/weekly", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      });
    expect(DigestRunResponseSchema.parse(await readJson(send()))).toEqual({
      kind: "weekly",
      periodKey: expect.any(String),
      status: "sent",
      duplicate: false,
    });
    expect(await readJson(send())).toMatchObject({ duplicate: true });
    expect(fixture.mail.sent).toHaveLength(1);
    expect(metrics.render()).toContain(
      'alert_dashboard_ops_digest_total{kind="weekly",result="sent"} 1',
    );
  });
});
