import { expect } from "vitest";

import {
  AlertmanagerSnapshotAlertSchema,
  AlertmanagerWebhookSchema,
} from "#shared/schema";
import { InstantTextSchema } from "#shared/time";
import {
  input,
  nanoseconds,
  prisma,
  repository,
  webhook,
} from "./sqlite-fixture.ts";

export async function matchesRefreshedResolution(): Promise<void> {
  const fingerprint = "fingerprint-promoted-resolution";
  const alert = AlertmanagerSnapshotAlertSchema.parse({
    annotations: { summary: "Promoted resolution" },
    endsAt: "0001-01-01T00:00:00Z",
    fingerprint,
    startsAt: "2026-08-08T18:00:00Z",
    generatorURL: "",
    labels: { alertname: "PromotedResolution", severity: "warning" },
    status: { inhibitedBy: [], silencedBy: [], state: "active" },
  });
  const minute = 60_000_000_000n;
  const start = nanoseconds("2026-08-08T18:00:00Z");
  await repository.reconcileSnapshot({
    alerts: [alert],
    startedAtNs: start,
    completedAtNs: start,
    missingGraceNs: 5n * minute,
  });
  await repository.reconcileSnapshot({
    alerts: [],
    startedAtNs: start + minute,
    completedAtNs: start + minute,
    missingGraceNs: 5n * minute,
  });
  await repository.reconcileSnapshot({
    alerts: [],
    startedAtNs: start + 7n * minute,
    completedAtNs: start + 7n * minute,
    missingGraceNs: 5n * minute,
  });
  const resolved = await repository.ingestWebhook(
    input(
      webhook(fingerprint, "resolved", "2026-08-08T18:10:00Z"),
      "2026-08-08T18:11:00Z",
    ),
  );
  expect(resolved.emailQueued).toBe(false);
  const afterResolved = await repository.listAlerts({ limit: 10 });
  expect(afterResolved.items).toHaveLength(1);
  expect(afterResolved.items[0]?.lifecycleState).toBe("resolved");
  expect(afterResolved.items[0]?.resolutionSource).toBe("webhook");
  const lateFire = await repository.ingestWebhook(
    input(
      webhook(fingerprint, "firing", "2026-08-08T18:05:00Z"),
      "2026-08-08T18:12:00Z",
    ),
  );
  expect(lateFire.emailQueued).toBe(false);
  const afterLateFire = await repository.listAlerts({ limit: 10 });
  expect(afterLateFire.items).toHaveLength(1);
  expect(afterLateFire.items[0]?.lifecycleState).toBe("resolved");
  const occurrenceId = afterLateFire.items[0]?.id;
  if (occurrenceId === undefined) throw new Error("expected occurrence");
  const detail = await repository.getAlert({ id: occurrenceId, limit: 10 });
  expect(detail?.events.map((event) => event.type).join(",")).toBe(
    "opened,reconciliation_discrepancy,resolved",
  );
}

export async function keepsStaleResolutionOnPriorOccurrence(): Promise<void> {
  const fingerprint = "fingerprint-stale-resolution";
  await repository.ingestWebhook(
    input(
      webhook(fingerprint, "firing", "2026-08-08T18:00:00Z"),
      "2026-08-08T18:00:01Z",
    ),
  );
  await repository.ingestWebhook(
    input(
      webhook(fingerprint, "resolved", "2026-08-08T18:05:00Z"),
      "2026-08-08T18:10:01Z",
    ),
  );
  await repository.ingestWebhook(
    input(
      webhook(fingerprint, "firing", "2026-08-08T18:20:00Z"),
      "2026-08-08T18:20:01Z",
    ),
  );

  const staleResolution = await repository.ingestWebhook(
    input(
      webhook(fingerprint, "resolved", "2026-08-08T18:07:00Z"),
      "2026-08-08T18:21:00Z",
    ),
  );

  expect(staleResolution.emailQueued).toBe(false);
  expect(staleResolution.resolved).toBe(0);
  const alerts = await repository.listAlerts({ limit: 10 });
  expect(alerts.items).toHaveLength(2);
  const current = alerts.items.find(
    (occurrence) => occurrence.lifecycleState === "open",
  );
  const prior = alerts.items.find(
    (occurrence) => occurrence.lifecycleState === "resolved",
  );
  expect(current?.openedAt).toBe(
    InstantTextSchema.parse("2026-08-08T18:20:00Z"),
  );
  expect(prior?.openedAt).toBe(InstantTextSchema.parse("2026-08-08T18:00:00Z"));
  if (current === undefined) throw new Error("expected current occurrence");
  if (prior === undefined) throw new Error("expected prior occurrence");
  const currentDetail = await repository.getAlert({
    id: current.id,
    limit: 10,
  });
  const priorDetail = await repository.getAlert({ id: prior.id, limit: 10 });
  expect(currentDetail?.events.map((event) => event.type)).toEqual(["opened"]);
  expect(priorDetail?.events.map((event) => event.type)).toEqual([
    "opened",
    "resolved",
  ]);
}

function syntheticResolvedHeartbeat(
  fingerprint: string,
  startsAt: string,
  endsAt: string,
) {
  const base = webhook(fingerprint, "resolved", startsAt);
  return AlertmanagerWebhookSchema.parse({
    ...base,
    groupKey: '{}:{alertname="FlagsManagedFlagDrift"}',
    groupLabels: { alertname: "FlagsManagedFlagDrift" },
    commonLabels: {
      alertname: "FlagsManagedFlagDrift",
      severity: "warning",
    },
    alerts: base.alerts.map((alert) => ({
      ...alert,
      labels: {
        alertname: "FlagsManagedFlagDrift",
        severity: "warning",
        namespace: "temporal",
      },
      startsAt,
      endsAt,
    })),
  });
}

export async function ignoresZeroDurationResolvedWithoutOpenOccurrence(): Promise<void> {
  const fingerprint = "fingerprint-zero-duration-orphan";
  const equalBounds = await repository.ingestWebhook(
    input(
      syntheticResolvedHeartbeat(
        fingerprint,
        "2026-08-08T18:10:00Z",
        "2026-08-08T18:10:00Z",
      ),
      "2026-08-08T18:10:01Z",
    ),
  );
  expect(equalBounds).toMatchObject({
    opened: 0,
    resolved: 0,
    emailQueued: false,
  });

  const invertedBounds = await repository.ingestWebhook(
    input(
      syntheticResolvedHeartbeat(
        fingerprint,
        "2026-08-08T18:15:00Z",
        "2026-08-08T18:14:00Z",
      ),
      "2026-08-08T18:15:01Z",
    ),
  );
  expect(invertedBounds).toMatchObject({
    opened: 0,
    resolved: 0,
    emailQueued: false,
  });

  const alerts = await repository.listAlerts({ limit: 10 });
  expect(alerts.items).toHaveLength(0);
  const events = await repository.listEvents({ limit: 10 });
  expect(events.items).toHaveLength(0);
  expect(await prisma.webhookDelivery.count()).toBe(2);
  expect(await prisma.webhookDeliveryOccurrence.count()).toBe(0);
}

export async function resolvesOpenOccurrenceOnZeroDurationHeartbeat(): Promise<void> {
  const fingerprint = "fingerprint-zero-duration-closes-open";
  const opened = await repository.ingestWebhook(
    input(
      webhook(fingerprint, "firing", "2026-08-08T18:00:00Z"),
      "2026-08-08T18:00:01Z",
    ),
  );
  expect(opened).toMatchObject({ opened: 1, resolved: 0, emailQueued: true });

  const resolved = await repository.ingestWebhook(
    input(
      syntheticResolvedHeartbeat(
        fingerprint,
        "2026-08-08T18:10:00Z",
        "2026-08-08T18:10:00Z",
      ),
      "2026-08-08T18:10:01Z",
    ),
  );
  expect(resolved).toMatchObject({
    opened: 0,
    resolved: 1,
    emailQueued: false,
  });

  // A subsequent healthy startsAt === endsAt heartbeat after closure must not
  // insert a brand-new 0.0m resolved occurrence.
  const followUpHeartbeat = await repository.ingestWebhook(
    input(
      syntheticResolvedHeartbeat(
        fingerprint,
        "2026-08-08T21:10:00Z",
        "2026-08-08T21:10:00Z",
      ),
      "2026-08-08T21:10:01Z",
    ),
  );
  expect(followUpHeartbeat).toMatchObject({
    opened: 0,
    resolved: 0,
    emailQueued: false,
  });

  const alerts = await repository.listAlerts({ limit: 10 });
  expect(alerts.items).toHaveLength(1);
  const occurrence = alerts.items[0];
  if (occurrence === undefined) {
    throw new Error("expected resolved occurrence");
  }
  expect(occurrence).toMatchObject({
    lifecycleState: "resolved",
    resolutionSource: "webhook",
    openedAt: InstantTextSchema.parse("2026-08-08T18:00:00Z"),
    resolvedAt: InstantTextSchema.parse("2026-08-08T18:10:00Z"),
  });
  const detail = await repository.getAlert({ id: occurrence.id, limit: 10 });
  expect(detail?.events.map((event) => event.type)).toEqual([
    "opened",
    "resolved",
  ]);
}
