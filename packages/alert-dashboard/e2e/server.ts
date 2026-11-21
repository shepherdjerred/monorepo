import { OPS_POLICY } from "@shepherdjerred/ops-model/policy.ts";
import type { OpsIngest } from "@shepherdjerred/ops-model/snapshot.ts";
import type { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

import type { AlertLedgerRepository } from "#application/ports";
import { AlertService } from "#application/alert-service";
import { createApp } from "#server/app";
import { ChangeBus } from "#server/change-bus";
import { Metrics } from "#server/metrics";
import {
  AlertDetailSchema,
  AlertListResponseSchema,
  EventListResponseSchema,
  SummarySchema,
  SystemStatusSchema,
  type AlertDetail,
  type AlertDetailInput,
  type AlertListInput,
  type EventListInput,
} from "#shared/schema";
import { fixedClock, systemClock } from "#shared/time";
import { fixtureOpsIngest } from "#test-fixtures/ops-snapshot";
import { volumeOpsIngest } from "#test-fixtures/ops-snapshot-volume";
import { createOpsFixture } from "#test-fixtures/ops-services";
import { promotionFixture } from "#test-fixtures/promotion";

const alert = AlertDetailSchema.parse({
  id: `alert_${"a".repeat(32)}`,
  fingerprint: "fixture-fingerprint",
  alertname: "DiskFull",
  namespace: "storage",
  severity: "warning",
  summary: "Storage volume is nearly full",
  lifecycleState: "open",
  suppressionState: "none",
  resolutionSource: null,
  openedAt: "2026-08-08T18:00:00Z",
  resolvedAt: null,
  lastSeenAt: "2026-08-08T18:05:00Z",
  generatorUrl: "https://prometheus.tailnet-1a49.ts.net/graph?g0.expr=up",
  labels: {
    alertname: "DiskFull",
    severity: "warning",
    namespace: "storage",
    pod: "storage-0",
  },
  annotations: {
    summary: "Storage volume is nearly full",
    runbook_url: "https://example.com/runbook",
    dashboard_url: "https://example.com/dashboard",
  },
  events: [
    {
      id: `event_${"b".repeat(32)}`,
      occurrenceId: `alert_${"a".repeat(32)}`,
      type: "opened",
      occurredAt: "2026-08-08T18:00:00Z",
      source: "webhook",
      detail: null,
    },
  ],
  deliveries: [
    {
      id: "123e4567-e89b-42d3-a456-426614174000",
      receivedAt: "2026-08-08T18:00:01Z",
      groupKey: '{}:{alertname="DiskFull"}',
      status: "firing",
      receiver: "alert-dashboard",
      truncatedAlerts: 0,
      notificationReason: null,
      payloadHash: "c".repeat(64),
      rawPayloadRetained: true,
      rawExpiresAt: "2026-11-06T18:00:01Z",
    },
  ],
  deliveriesNextCursor: "123e4567-e89b-42d3-a456-426614174000",
});

const olderDelivery = {
  id: "123e4567-e89b-42d3-a456-426614174001",
  receivedAt: "2026-08-08T17:55:01Z",
  groupKey: '{}:{alertname="DiskFull"}',
  status: "firing",
  receiver: "alert-dashboard",
  truncatedAlerts: 0,
  notificationReason: null,
  payloadHash: "d".repeat(64),
  rawPayloadRetained: true,
  rawExpiresAt: "2026-11-06T17:55:01Z",
};

const paginatedAlert = AlertDetailSchema.parse({
  ...alert,
  id: `alert_${"d".repeat(32)}`,
  fingerprint: "fixture-pagination-fingerprint",
  alertname: "PaginationFixture",
  summary: "Lifecycle pagination fixture",
  events: [],
  deliveries: [],
  deliveriesNextCursor: null,
});
const paginatedEvents = Array.from({ length: 101 }, (_, index) => ({
  id: `event_${index.toString(16).padStart(32, "0")}`,
  occurrenceId: paginatedAlert.id,
  type: "opened",
  occurredAt: "2026-08-08T18:00:00Z",
  source: "snapshot",
  detail: null,
  alert: paginatedAlert,
}));
const paginationCursor = paginatedEvents[99]?.id;
if (paginationCursor === undefined)
  throw new Error("fixture pagination cursor is missing");
const paginatedAlerts = Array.from({ length: 101 }, (_, index) =>
  AlertDetailSchema.parse({
    ...alert,
    id: `alert_${index.toString(16).padStart(32, "0")}`,
    fingerprint: `fixture-alert-pagination-${String(index)}`,
    alertname: `PaginationAlert${String(index + 1)}`,
    summary: `Active alert pagination fixture ${String(index + 1)}`,
    events: [],
    deliveries: [],
    deliveriesNextCursor: null,
  }),
);
const alertPaginationCursor = paginatedAlerts[99]?.id;
if (alertPaginationCursor === undefined)
  throw new Error("fixture alert pagination cursor is missing");

class FixtureRepository implements AlertLedgerRepository {
  ingestWebhook = () =>
    Promise.resolve({
      deliveryId: "123e4567-e89b-42d3-a456-426614174000",
      opened: 0,
      resolved: 0,
      emailQueued: false,
    });
  reconcileSnapshot = () =>
    Promise.resolve({ active: 1, opened: 0, resolved: 0 });
  recordSnapshotFailure = () => Promise.resolve();
  listAlerts = (input: AlertListInput) =>
    Promise.resolve(
      AlertListResponseSchema.parse({
        items:
          input.search === "PaginationFixture"
            ? input.cursor === undefined
              ? paginatedAlerts.slice(0, 100)
              : paginatedAlerts.slice(100)
            : input.severity === undefined || input.severity === alert.severity
              ? [alert]
              : [],
        nextCursor:
          input.search === "PaginationFixture" && input.cursor === undefined
            ? alertPaginationCursor
            : null,
      }),
    );
  getAlert = (input: AlertDetailInput): Promise<AlertDetail | null> =>
    Promise.resolve(
      input.id === alert.id
        ? input.cursor === undefined
          ? alert
          : AlertDetailSchema.parse({
              ...alert,
              deliveries: [olderDelivery],
              deliveriesNextCursor: null,
            })
        : null,
    );
  listEvents = (input: EventListInput) => {
    if (input.alertname === "PaginationFixture") {
      const firstPage = input.cursor === undefined;
      return Promise.resolve(
        EventListResponseSchema.parse({
          items: firstPage
            ? paginatedEvents.slice(0, 100)
            : paginatedEvents.slice(100),
          nextCursor: firstPage ? paginationCursor : null,
        }),
      );
    }
    const event = alert.events[0];
    if (event === undefined)
      throw new Error("fixture lifecycle event is missing");
    return Promise.resolve(
      EventListResponseSchema.parse({
        items: [{ ...event, alert }],
        nextCursor: null,
      }),
    );
  };
  summary = () =>
    Promise.resolve(
      SummarySchema.parse({
        open: 1,
        resolved: 0,
        critical: 0,
        warning: 1,
        info: 0,
        silenced: 0,
        inhibited: 0,
        unprocessed: 0,
        lastReconciledAt: "2026-08-08T18:05:00Z",
      }),
    );
  checkDatabase = () => Promise.resolve();
  systemStatus = () =>
    Promise.resolve(
      SystemStatusSchema.parse({
        database: "ok",
        alertmanager: "ok",
        grafana: "ok",
        postal: "disabled",
        emailEnabled: false,
        pendingEmails: 0,
        failedEmails: 0,
        oldestPendingEmailAt: null,
        lastReconciledAt: "2026-08-08T18:05:00Z",
      }),
    );
  pendingEmails = () => Promise.resolve([]);
  claimPendingEmails = () => Promise.resolve([]);
  markEmailSent = () => Promise.resolve();
  markEmailFailed = () => Promise.resolve();
  purgeExpiredRecords = () =>
    Promise.resolve({ webhookDeliveries: 0, snapshotRuns: 0 });
  disconnect = () => Promise.resolve();
}

const service = new AlertService({
  repository: new FixtureRepository(),
  alertmanager: { activeAlerts: () => Promise.resolve([]) },
  postal: { send: () => Promise.resolve() },
  previews: {
    health: () => Promise.resolve(true),
    previews: () =>
      Promise.resolve({
        prometheus: { status: "available", query: "up", data: { result: [] } },
        loki: { status: "error", reason: "Loki fixture unavailable" },
        tempo: { status: "unavailable", reason: "No valid trace ID metadata" },
      }),
  },
  clock: fixedClock("2026-08-08T20:00:00Z"),
  emailEnabled: false,
});
// `OPS_FIXTURE` picks the ops snapshot. Unset is the small e2e fixture the
// Playwright specs assert against; `bun run dev:fixture` always sets it.
const { OPS_FIXTURE: requestedOpsFixture } = z
  .object({
    OPS_FIXTURE: z.enum(["default", "volume", "volume-aggregate"]).optional(),
  })
  .parse({ OPS_FIXTURE: Bun.env["OPS_FIXTURE"] });

function opsIngestBody(now: Temporal.Instant): OpsIngest {
  const generatedAt = now.subtract({ minutes: 2 }).toString();
  switch (requestedOpsFixture) {
    case "volume":
      return volumeOpsIngest(generatedAt, "per-update");
    case "volume-aggregate":
      return volumeOpsIngest(generatedAt, "aggregate");
    case "default":
    case undefined:
      return fixtureOpsIngest(generatedAt);
  }
}

// Ops pages render relative ages, so the ops fixture uses the real clock and
// a snapshot generated moments before the server started.
const opsFixture = createOpsFixture(systemClock);
const opsNow = systemClock.now();
await opsFixture.ops.ingest(JSON.stringify(opsIngestBody(opsNow)));
if (requestedOpsFixture !== undefined) {
  // A long-lived dev server would otherwise serve a stale snapshot after
  // three intervals, so it re-ingests on the collector's cadence.
  setInterval(() => {
    void opsFixture.ops.ingest(
      JSON.stringify(opsIngestBody(systemClock.now())),
    );
  }, OPS_POLICY.snapshotIntervalMinutes * 60_000);
}
opsFixture.repository.alertLedger = [
  {
    eventId: `event_${"e".repeat(32)}`,
    occurrenceId: `alert_${"e".repeat(32)}`,
    type: "opened",
    occurredAtNs: opsNow.subtract({ hours: 2 }).epochNanoseconds,
    alertname: "HomelabBackupStale",
    namespace: "velero",
    severity: "critical",
    summary: "Velero backup is stale",
  },
  {
    eventId: `event_${"f".repeat(32)}`,
    occurrenceId: `alert_${"f".repeat(32)}`,
    type: "resolved",
    occurredAtNs: opsNow.subtract({ hours: 3 }).epochNanoseconds,
    alertname: "PodCrashLooping",
    namespace: "scout-beta",
    severity: "warning",
    summary: "scout-beta worker restarted repeatedly",
  },
];
const app = createApp({
  service,
  changes: new ChangeBus(),
  metrics: new Metrics(),
  webhookToken: "fixture-webhook-token-with-32-characters",
  ops: opsFixture.ops,
  digests: opsFixture.digests,
  opsIngestToken: "fixture-ops-ingest-token-with-32-characters",
});
const port = Number(
  Bun.argv[2] ?? Bun.env["ALERT_DASHBOARD_E2E_PORT"] ?? "17341",
);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("ALERT_DASHBOARD_E2E_PORT must be a valid TCP port");
}
Bun.serve({
  hostname: "127.0.0.1",
  port,
  routes: {
    "/api/v1/promotion": { GET: () => Response.json(promotionFixture) },
  },
  fetch: app.fetch,
});
