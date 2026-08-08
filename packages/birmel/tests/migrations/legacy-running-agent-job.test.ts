import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BASELINE_MIGRATION_URL = new URL(
  "../../prisma/migrations/20260808000000_baseline/migration.sql",
  import.meta.url,
);
const RUNTIME_MIGRATION_URL = new URL(
  "../../prisma/migrations/20260808010000_birmel_3_runtime/migration.sql",
  import.meta.url,
);

const BASELINE_SQL = await Bun.file(BASELINE_MIGRATION_URL).text();
const RUNTIME_SQL = await Bun.file(RUNTIME_MIGRATION_URL).text();
const RECOVERY_REASON =
  "Legacy execution was interrupted with an unknown effect outcome";
setDefaultTimeout(30_000);

type CountRow = { count: number };
type MigratedJobRow = {
  status: string;
  nextRunAt: string | null;
  attemptCount: number;
  lastStatus: string | null;
  lastError: string | null;
  claimedAt: string | null;
  claimedBy: string | null;
  leaseExpiresAt: string | null;
};
type MigratedRunRow = {
  status: string;
  finishedAt: string | null;
  error: string | null;
  metadata: string | null;
};

async function withProductionShapedDatabase(
  run: (database: Database) => void,
): Promise<void> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "birmel-running-job-migration-"),
  );
  const database = new Database(path.join(directory, "birmel.db"), {
    create: true,
    strict: true,
  });
  try {
    database.run(BASELINE_SQL);
    run(database);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function seedInterruptedLegacyExecution(
  database: Database,
  status: "running" | "retrying" | "active" | "completed",
): void {
  database.run(`
    INSERT INTO "AgentJob" (
      "id", "guildId", "channelId", "threadId", "userId", "name",
      "scheduleKind", "scheduleValue", "timezone", "nextRunAt", "status",
      "payloadKind", "message", "deliveryMode", "maxAttempts", "timeoutMs",
      "attemptCount", "createdAt", "updatedAt"
    ) VALUES (
      'interrupted-job', 'guild-job', 'channel-job', 'thread-job',
      'trusted-user', 'Interrupted legacy job', 'at',
      '2026-08-08T15:00:00.000Z', 'UTC', '2026-08-08T15:00:00.000Z',
      '${status}', 'message', 'Deliver exactly once', 'discord', 4, 42000, 2,
      '2026-08-08T14:00:00.000Z', '2026-08-08T15:01:00.000Z'
    );

    INSERT INTO "AgentJobRun" (
      "id", "jobId", "status", "startedAt", "metadata", "createdAt"
    ) VALUES (
      'interrupted-run', 'interrupted-job', 'running',
      '2026-08-08T15:01:00.000Z',
      '{"scheduledFor":"2026-08-08T15:00:00.000Z","attemptCount":2}',
      '2026-08-08T15:01:00.000Z'
    );

    INSERT INTO "AgentJobRun" (
      "id", "jobId", "status", "startedAt", "finishedAt", "output",
      "metadata", "createdAt"
    ) VALUES (
      'replacement-run', 'interrupted-job', 'success',
      '2026-08-08T15:02:00.000Z', '2026-08-08T15:03:00.000Z',
      '{"delivered":true}',
      '{"scheduledFor":"2026-08-08T15:00:00.000Z","attemptCount":3}',
      '2026-08-08T15:02:00.000Z'
    );
  `);
}

function seedRetryableLegacyExecution(database: Database): void {
  database.run(`
    INSERT INTO "AgentJob" (
      "id", "guildId", "channelId", "userId", "name", "scheduleKind",
      "scheduleValue", "timezone", "nextRunAt", "status", "payloadKind",
      "message", "deliveryMode", "maxAttempts", "timeoutMs", "attemptCount",
      "lastStatus", "lastError", "createdAt", "updatedAt"
    ) VALUES (
      'retryable-job', 'guild-job', 'channel-job', 'trusted-user',
      'Retryable legacy job', 'every', '1h', 'UTC',
      '2026-08-08T16:00:00.000Z', 'retrying', 'message', 'Try again',
      'discord', 4, 42000, 2, 'error', 'Temporary provider failure',
      '2026-08-08T14:00:00.000Z', '2026-08-08T15:01:00.000Z'
    );

    INSERT INTO "AgentJobRun" (
      "id", "jobId", "status", "startedAt", "finishedAt", "error",
      "createdAt"
    ) VALUES (
      'retryable-run', 'retryable-job', 'error',
      '2026-08-08T15:00:00.000Z', '2026-08-08T15:01:00.000Z',
      'Temporary provider failure', '2026-08-08T15:00:00.000Z'
    );
  `);
}

function seedOrphanedLegacyExecution(database: Database): void {
  database.run(`
    INSERT INTO "AgentJob" (
      "id", "guildId", "channelId", "userId", "name", "scheduleKind",
      "scheduleValue", "timezone", "nextRunAt", "status", "payloadKind",
      "message", "deliveryMode", "maxAttempts", "timeoutMs", "attemptCount",
      "createdAt", "updatedAt"
    ) VALUES (
      'orphaned-job', 'guild-job', 'channel-job', 'trusted-user',
      'Orphaned legacy job', 'at', '2026-08-08T16:00:00.000Z', 'UTC',
      '2026-08-08T16:00:00.000Z', 'running', 'message', 'Try once',
      'discord', 4, 42000, 0,
      '2026-08-08T14:00:00.000Z', '2026-08-08T15:01:00.000Z'
    );
  `);
}

describe("Birmel 3 legacy running AgentJob migration", () => {
  for (const status of [
    "running",
    "retrying",
    "active",
    "completed",
  ] as const) {
    test(`fences an interrupted child run under a ${status} parent for operator resolution`, async () => {
      await withProductionShapedDatabase((database) => {
        seedInterruptedLegacyExecution(database, status);

        database.run(RUNTIME_SQL);

        expect(
          database
            .query<
              MigratedJobRow,
              []
            >(`SELECT "status", "nextRunAt", "attemptCount", "lastStatus", "lastError", "claimedAt", "claimedBy", "leaseExpiresAt" FROM "AgentJob" WHERE "id" = 'interrupted-job'`)
            .get(),
        ).toEqual({
          status: "paused",
          nextRunAt: null,
          attemptCount: 2,
          lastStatus: "recovery_ambiguous",
          lastError: RECOVERY_REASON,
          claimedAt: null,
          claimedBy: null,
          leaseExpiresAt: null,
        });

        const migratedRun = database
          .query<
            MigratedRunRow,
            []
          >(`SELECT "status", "finishedAt", "error", "metadata" FROM "AgentJobRun" WHERE "id" = 'interrupted-run'`)
          .get();
        expect(migratedRun).toMatchObject({
          status: "effect_ambiguous",
          error: RECOVERY_REASON,
          metadata:
            '{"scheduledFor":"2026-08-08T15:00:00.000Z","attemptCount":2}',
        });
        expect(migratedRun?.finishedAt).not.toBeNull();
        expect(
          database
            .query<
              { status: string },
              []
            >(`SELECT "status" FROM "AgentJobRun" WHERE "id" = 'replacement-run'`)
            .get(),
        ).toEqual({ status: "success" });
        expect(
          database
            .query<
              CountRow,
              []
            >(`SELECT COUNT(*) AS "count" FROM "AgentJob" WHERE "status" = 'running' AND "claimedBy" IS NULL`)
            .get()?.count,
        ).toBe(0);
        expect(
          database
            .query<
              CountRow,
              []
            >(`SELECT COUNT(*) AS "count" FROM "AgentJobRun" WHERE "status" = 'running'`)
            .get()?.count,
        ).toBe(0);
      });
    });
  }

  test("keeps a terminal retrying job eligible for restart recovery", async () => {
    await withProductionShapedDatabase((database) => {
      seedRetryableLegacyExecution(database);

      database.run(RUNTIME_SQL);

      expect(
        database
          .query<
            MigratedJobRow,
            []
          >(`SELECT "status", "nextRunAt", "attemptCount", "lastStatus", "lastError", "claimedAt", "claimedBy", "leaseExpiresAt" FROM "AgentJob" WHERE "id" = 'retryable-job'`)
          .get(),
      ).toEqual({
        status: "retrying",
        nextRunAt: "2026-08-08T16:00:00.000Z",
        attemptCount: 2,
        lastStatus: "error",
        lastError: "Temporary provider failure",
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
      });
      expect(
        database
          .query<
            { status: string },
            []
          >(`SELECT "status" FROM "AgentJobRun" WHERE "id" = 'retryable-run'`)
          .get(),
      ).toEqual({ status: "error" });
    });
  });

  test("retries a running parent when execution never created a run", async () => {
    await withProductionShapedDatabase((database) => {
      seedOrphanedLegacyExecution(database);

      database.run(RUNTIME_SQL);

      expect(
        database
          .query<
            MigratedJobRow,
            []
          >(`SELECT "status", "nextRunAt", "attemptCount", "lastStatus", "lastError", "claimedAt", "claimedBy", "leaseExpiresAt" FROM "AgentJob" WHERE "id" = 'orphaned-job'`)
          .get(),
      ).toEqual({
        status: "retrying",
        nextRunAt: "2026-08-08T16:00:00.000Z",
        attemptCount: 0,
        lastStatus: "recovered",
        lastError: "Recovered legacy execution before a run was recorded",
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
      });
    });
  });
});
