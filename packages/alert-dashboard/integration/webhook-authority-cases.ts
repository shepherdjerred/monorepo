import { expect } from "bun:test";

import { AlertmanagerSnapshotAlertSchema } from "#shared/schema";
import { InstantTextSchema } from "#shared/time";
import { input, nanoseconds, repository, webhook } from "./postgres-fixture.ts";

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
