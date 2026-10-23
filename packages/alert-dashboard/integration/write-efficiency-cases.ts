import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createPrismaClient } from "#infrastructure/prisma-client";
import {
  AlertmanagerSnapshotAlertSchema,
  type AlertmanagerSnapshotAlert,
} from "#shared/schema";
import { epochNanosecondsToInstantText } from "#shared/time";
import {
  databaseUrl,
  input,
  nanoseconds,
  prisma,
  repository,
  webhook,
} from "./sqlite-fixture.ts";

const SECOND = 1_000_000_000n;
const MINUTE = 60n * SECOND;
const START = nanoseconds("2026-08-08T18:00:00Z");
const GRACE = 5n * MINUTE;

/**
 * libSQL opens a fresh connection for each transaction, so SQLite's
 * per-connection `changes()` counters cannot see the reconciler's writes. Row
 * triggers on the ledger tables count every insert, update, and delete instead,
 * whichever connection makes them.
 */
const AUDITED_TABLES = [
  "AlertOccurrence",
  "AlertOccurrenceLabel",
  "AlertEvent",
  "SnapshotRun",
  "WebhookDelivery",
  "WebhookDeliveryOccurrence",
] as const;
const AUDITED_OPERATIONS = ["INSERT", "UPDATE", "DELETE"] as const;
const AuditRowsSchema = z.array(
  z.object({ write: z.string(), count: z.coerce.number() }),
);
const PragmaRowsSchema = z.array(z.record(z.string(), z.coerce.number()));

async function installWriteAudit(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'CREATE TABLE "WriteAudit" ("write" TEXT NOT NULL)',
  );
  for (const table of AUDITED_TABLES)
    for (const operation of AUDITED_OPERATIONS)
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER "audit_${table}_${operation}" AFTER ${operation} ON "${table}" BEGIN INSERT INTO "WriteAudit" ("write") VALUES ('${table}:${operation}'); END`,
      );
}

async function removeWriteAudit(): Promise<void> {
  for (const table of AUDITED_TABLES)
    for (const operation of AUDITED_OPERATIONS)
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS "audit_${table}_${operation}"`,
      );
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "WriteAudit"');
}

/** Row writes since the last call, keyed `Table:OPERATION`. */
async function takeWrites(): Promise<Record<string, number>> {
  const rows = AuditRowsSchema.parse(
    await prisma.$queryRawUnsafe(
      'SELECT "write", COUNT(*) AS "count" FROM "WriteAudit" GROUP BY "write"',
    ),
  );
  await prisma.$executeRawUnsafe('DELETE FROM "WriteAudit"');
  return Object.fromEntries(rows.map((row) => [row.write, row.count]));
}

function snapshotAlert(
  fingerprint: string,
  options: { labels?: Record<string, string>; silenced?: boolean } = {},
): AlertmanagerSnapshotAlert {
  return AlertmanagerSnapshotAlertSchema.parse({
    annotations: { summary: `Write efficiency ${fingerprint}` },
    endsAt: "0001-01-01T00:00:00Z",
    fingerprint,
    startsAt: "2026-08-08T18:00:00Z",
    generatorURL: "",
    labels: options.labels ?? {
      alertname: "WriteEfficiency",
      severity: "warning",
      namespace: "storage",
      instance: fingerprint,
    },
    status: {
      inhibitedBy: [],
      silencedBy: options.silenced === true ? ["silence-1"] : [],
      state: options.silenced === true ? "suppressed" : "active",
    },
  });
}

function completedAt(minute: bigint): bigint {
  return START + minute * MINUTE + SECOND;
}

async function reconcileAt(
  minute: bigint,
  alerts: readonly AlertmanagerSnapshotAlert[],
): Promise<void> {
  await repository.reconcileSnapshot({
    alerts,
    startedAtNs: START + minute * MINUTE,
    completedAtNs: completedAt(minute),
    missingGraceNs: GRACE,
  });
}

async function alertByFingerprint(fingerprint: string) {
  const alerts = await repository.listAlerts({ limit: 100 });
  const alert = alerts.items.find((item) => item.fingerprint === fingerprint);
  if (alert === undefined) throw new Error(`expected ${fingerprint}`);
  return alert;
}

async function lastSeenAt(fingerprint: string): Promise<string> {
  const alert = await alertByFingerprint(fingerprint);
  return alert.lastSeenAt;
}

async function pragma(
  client: Awaited<ReturnType<typeof createPrismaClient>>,
  name: string,
): Promise<number | undefined> {
  const rows = PragmaRowsSchema.parse(
    await client.$queryRawUnsafe(`PRAGMA ${name}`),
  );
  return rows[0]?.[name];
}

function registerWriteCases(): void {
  describe("SQLite reconciliation writes", () => {
    beforeEach(installWriteAudit);
    afterEach(removeWriteAudit);

    it("writes only the snapshot run for an unchanged snapshot", async () => {
      const alerts = ["fp-a", "fp-b", "fp-c"].map((fingerprint) =>
        snapshotAlert(fingerprint),
      );
      await reconcileAt(0n, alerts);
      await takeWrites();

      await reconcileAt(1n, alerts);
      expect(await takeWrites()).toEqual({ "SnapshotRun:INSERT": 1 });
      const listed = await repository.listAlerts({ limit: 10 });
      expect(listed.items.map((item) => item.lastSeenAt)).toEqual(
        Array.from({ length: 3 }, () =>
          epochNanosecondsToInstantText(completedAt(1n)),
        ),
      );
    });

    it("diffs labels and records suppression changes in one row update", async () => {
      await reconcileAt(0n, [snapshotAlert("fp-a")]);
      await takeWrites();

      await reconcileAt(1n, [
        snapshotAlert("fp-a", {
          silenced: true,
          labels: {
            alertname: "WriteEfficiency",
            severity: "warning",
            namespace: "storage",
            pod: "replacement",
          },
        }),
      ]);
      expect(await takeWrites()).toEqual({
        "AlertOccurrence:UPDATE": 1,
        "AlertOccurrenceLabel:DELETE": 1,
        "AlertOccurrenceLabel:INSERT": 1,
        "AlertEvent:INSERT": 1,
        "SnapshotRun:INSERT": 1,
      });
      const alert = await alertByFingerprint("fp-a");
      expect(alert.suppressionState).toBe("silenced");
      expect(alert.labels).toEqual({
        alertname: "WriteEfficiency",
        severity: "warning",
        namespace: "storage",
        pod: "replacement",
      });
      const byLabel = await repository.listAlerts({
        limit: 10,
        label: { pod: "replacement" },
      });
      expect(byLabel.items.map((item) => item.id)).toEqual([alert.id]);
      expect(
        await repository.listAlerts({
          limit: 10,
          label: { instance: "fp-a" },
        }),
      ).toMatchObject({ items: [] });
    });
  });
}

function registerLifecycleCases(): void {
  describe("SQLite derived liveness", () => {
    it("keeps missing, resolve, and reopen semantics without per-cycle writes", async () => {
      const a = snapshotAlert("fp-a");
      const b = snapshotAlert("fp-b");
      await reconcileAt(0n, [a, b]);
      await reconcileAt(1n, [a, b]);
      await reconcileAt(2n, [a, b]);
      expect(await lastSeenAt("fp-a")).toBe(
        epochNanosecondsToInstantText(completedAt(2n)),
      );

      // First absence: the derived last-seen instant is frozen at the last
      // snapshot that observed the alert.
      await reconcileAt(3n, [b]);
      const missing = await alertByFingerprint("fp-a");
      expect(missing.lifecycleState).toBe("open");
      expect(missing.lastSeenAt).toBe(
        epochNanosecondsToInstantText(completedAt(2n)),
      );
      expect(await lastSeenAt("fp-b")).toBe(
        epochNanosecondsToInstantText(completedAt(3n)),
      );
      const discrepancies = await repository.listEvents({
        limit: 10,
        type: "reconciliation_discrepancy",
      });
      expect(discrepancies.items.map((event) => event.alert.id)).toEqual([
        missing.id,
      ]);

      await reconcileAt(9n, [b]);
      const resolved = await alertByFingerprint("fp-a");
      expect(resolved.lifecycleState).toBe("resolved");
      expect(resolved.resolutionSource).toBe("reconciled");
      expect(resolved.resolvedAt).toBe(
        epochNanosecondsToInstantText(completedAt(9n)),
      );
      expect(resolved.lastSeenAt).toBe(
        epochNanosecondsToInstantText(completedAt(2n)),
      );

      await reconcileAt(10n, [a, b]);
      const reopened = await alertByFingerprint("fp-a");
      expect(reopened).toMatchObject({
        lifecycleState: "open",
        resolvedAt: null,
        resolutionSource: null,
        lastSeenAt: epochNanosecondsToInstantText(completedAt(10n)),
      });

      await installWriteAudit();
      try {
        await reconcileAt(11n, [a, b]);
        expect(await takeWrites()).toEqual({ "SnapshotRun:INSERT": 1 });
      } finally {
        await removeWriteAudit();
      }
      expect(await lastSeenAt("fp-a")).toBe(
        epochNanosecondsToInstantText(completedAt(11n)),
      );
    });
  });
}

function registerRetentionCases(): void {
  describe("SQLite retention", () => {
    it("deletes expired deliveries with their links and bounds snapshot runs", async () => {
      await repository.ingestWebhook(
        input(webhook("fp-retained", "firing"), "2026-08-08T18:00:01Z"),
      );
      expect(await prisma.webhookDeliveryOccurrence.count()).toBe(1);
      // 2,500 old runs exercise several retention batches.
      await prisma.snapshotRun.createMany({
        data: Array.from({ length: 2500 }, (_, index) => ({
          id: crypto.randomUUID(),
          startedAtNs: START + BigInt(index) * SECOND,
          completedAtNs: START + BigInt(index) * SECOND,
          status: "success",
          activeCount: 0,
          openedCount: 0,
          resolvedCount: 0,
        })),
      });
      await reconcileAt(60n, []);
      await repository.recordSnapshotFailure(
        START + 61n * MINUTE,
        START + 61n * MINUTE + SECOND,
        "Alertmanager unavailable",
      );

      expect(
        await repository.purgeExpiredRecords({
          nowNs: nanoseconds("2026-08-09T00:00:00Z"),
          snapshotRunCutoffNs: nanoseconds("2026-08-09T00:00:00Z"),
        }),
      ).toEqual({ webhookDeliveries: 1, snapshotRuns: 2500 });
      expect(await prisma.webhookDelivery.count()).toBe(0);
      expect(await prisma.webhookDeliveryOccurrence.count()).toBe(0);
      expect(await prisma.alertOccurrence.count()).toBe(1);
      const kept = await prisma.snapshotRun.findMany({
        orderBy: { completedAtNs: "asc" },
        select: { status: true, completedAtNs: true },
      });
      expect(kept).toEqual([
        { status: "success", completedAtNs: completedAt(60n) },
        { status: "error", completedAtNs: START + 61n * MINUTE + SECOND },
      ]);
      const status = await repository.systemStatus(false, START + 62n * MINUTE);
      expect(status.lastReconciledAt).toBe(
        epochNanosecondsToInstantText(completedAt(60n)),
      );
    });
  });
}

function registerPragmaCases(): void {
  describe("SQLite connection pragmas", () => {
    it("applies pragmas to every libSQL connection, including transactions", async () => {
      const client = await createPrismaClient(databaseUrl);
      try {
        // Each transaction takes the client's connection and libSQL opens a
        // replacement; check a later transaction and the replacement.
        await client.$transaction((transaction) =>
          transaction.$queryRawUnsafe("SELECT 1"),
        );
        const inTransaction = await client.$transaction(
          async (transaction) => ({
            foreignKeys: PragmaRowsSchema.parse(
              await transaction.$queryRawUnsafe("PRAGMA foreign_keys"),
            )[0]?.["foreign_keys"],
            busyTimeout: PragmaRowsSchema.parse(
              await transaction.$queryRawUnsafe("PRAGMA busy_timeout"),
            )[0]?.["timeout"],
            synchronous: PragmaRowsSchema.parse(
              await transaction.$queryRawUnsafe("PRAGMA synchronous"),
            )[0]?.["synchronous"],
          }),
        );
        expect(inTransaction).toEqual({
          foreignKeys: 1,
          busyTimeout: 5000,
          synchronous: 1,
        });
        expect(await pragma(client, "foreign_keys")).toBe(1);
        expect(await pragma(client, "synchronous")).toBe(1);
      } finally {
        await client.$disconnect();
      }
    });
  });
}

/** Write-efficiency, retention, and connection cases for the SQLite ledger. */
export function registerWriteEfficiencyCases(): void {
  registerWriteCases();
  registerLifecycleCases();
  registerRetentionCases();
  registerPragmaCases();
}
