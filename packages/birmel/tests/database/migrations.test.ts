import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LEGACY_BASELINE_MIGRATIONS,
  readDatabaseFingerprint,
  REQUIRED_MIGRATIONS,
  verifyBaselineFingerprint,
} from "@shepherdjerred/birmel/database/migration-bootstrap.ts";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BOOTSTRAP_MODULE_URL = new URL(
  "../../src/database/migration-bootstrap.ts",
  import.meta.url,
).href;
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

const FINAL_TABLES = [
  "AgentJob",
  "AgentJobRun",
  "AgentRun",
  "AgentSession",
  "AgentSessionEvent",
  "Birthday",
  "DailyPostConfig",
  "EditorSession",
  "ElectionPoll",
  "GitHubAuth",
  "GuildOwner",
  "LegacyAgentRuntimeArchive",
  "MemoryClaim",
  "MemoryExtractionFence",
  "MemorySourceFence",
  "MemoryRevision",
  "MusicHistory",
  "PollRecord",
  "ScheduledAnnouncement",
  "ServerEvent",
  "UserActivity",
].toSorted((left, right) => left.localeCompare(right));

type NameRow = { name: string };
type CountRow = { count: number };
type SchemaRow = { sql: string | null };

async function withTemporaryDatabase(
  run: (databasePath: string) => Promise<void> | void,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "birmel-migrations-"));
  try {
    await run(path.join(directory, "birmel.db"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function openDatabase(databasePath: string): Database {
  return new Database(databasePath, { create: true, strict: true });
}

function seedLegacyMigrationHistory(
  database: Database,
  migrations: readonly {
    migrationName: string;
    checksum: string;
  }[] = LEGACY_BASELINE_MIGRATIONS,
): void {
  database.run(`
    CREATE TABLE "_prisma_migrations" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
      "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
    )
  `);
  const insertMigration = database.prepare(`
    INSERT INTO "_prisma_migrations" (
      "id", "checksum", "finished_at", "migration_name", "started_at",
      "applied_steps_count"
    ) VALUES (?, ?, ?, ?, ?, 1)
  `);
  for (const [index, migration] of migrations.entries()) {
    const timestamp = `2026-06-03T00:00:0${String(index)}.000Z`;
    insertMigration.run(
      `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
      migration.checksum,
      timestamp,
      migration.migrationName,
      timestamp,
    );
  }
}

async function runCommand(
  command: string[],
  databasePath: string,
): Promise<void> {
  const child = Bun.spawn(command, {
    cwd: PACKAGE_ROOT,
    env: {
      ...Bun.env,
      DATABASE_PATH: databasePath,
      DATABASE_URL: `file:${databasePath}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} exited with code ${String(exitCode)}\n${stdout}\n${stderr}`,
    );
  }
}

async function runMigrationBootstrap(databasePath: string): Promise<void> {
  const script = `const bootstrap = await import(${JSON.stringify(BOOTSTRAP_MODULE_URL)}); await bootstrap.deployDatabaseMigrations();`;
  await runCommand(["bun", "-e", script], databasePath);
}

async function expectPrismaSchemaMatch(databasePath: string): Promise<void> {
  await runCommand(
    [
      "bunx",
      "--trust",
      "prisma",
      "migrate",
      "diff",
      "--from-config-datasource",
      "--to-schema",
      "prisma/schema.prisma",
      "--exit-code",
    ],
    databasePath,
  );
}

function tableColumns(database: Database, table: string): string[] {
  return database
    .query<NameRow, []>(`PRAGMA table_info("${table}")`)
    .all()
    .map((row) => row.name);
}

function expectFinalSchema(
  database: Database,
  hasMigrationTable: boolean,
): void {
  const fingerprint = readDatabaseFingerprint(database);
  expect(fingerprint.hasMigrationTable).toBe(hasMigrationTable);
  expect(fingerprint.tables).toEqual(FINAL_TABLES);

  expect(tableColumns(database, "AgentJob")).toEqual(
    expect.arrayContaining([
      "actorUserId",
      "sourceMessageId",
      "agentPrompt",
      "sessionId",
      "claimedAt",
      "claimedBy",
      "leaseExpiresAt",
    ]),
  );
  expect(tableColumns(database, "AgentJob")).not.toContain("userId");
  expect(tableColumns(database, "AgentSession")).toEqual(
    expect.arrayContaining([
      "threadId",
      "actorUserId",
      "summaryVersion",
      "summaryThroughSequence",
      "archivedAt",
      "cancelledAt",
    ]),
  );
  expect(tableColumns(database, "AgentSession")).not.toContain(
    "steeringPolicy",
  );
  expect(tableColumns(database, "AgentSessionEvent")).toEqual(
    expect.arrayContaining(["sequence", "discordMessageId", "toolId"]),
  );
  expect(tableColumns(database, "MemoryClaim")).toContain("identityKey");
  expect(tableColumns(database, "MemoryRevision")).toContain(
    "sourceDiscordMessageIds",
  );

  const foreignKeyViolations = database
    .query<Record<string, unknown>, []>("PRAGMA foreign_key_check")
    .all();
  expect(foreignKeyViolations).toEqual([]);
}

function seedProductionShapedRows(database: Database): void {
  database.run("PRAGMA foreign_keys = ON");
  database.run(`
    INSERT INTO "DailyPostConfig" (
      "id", "guildId", "channelId", "enabled", "postTime", "timezone",
      "createdAt", "updatedAt"
    ) VALUES (
      1, 'guild-product', 'channel-product', true, '08:30',
      'America/Los_Angeles', '2026-08-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z'
    );

    INSERT INTO "PollRecord" (
      "id", "guildId", "channelId", "messageId", "pollId", "question",
      "createdBy", "expiresAt", "createdAt"
    ) VALUES (
      1, 'guild-product', 'channel-product', 'poll-message', 'poll-id',
      'Ship Birmel 3?', 'trusted-user', '2026-08-09T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z'
    );

    INSERT INTO "AgentJob" (
      "id", "guildId", "channelId", "threadId", "userId", "name",
      "scheduleKind", "scheduleValue", "timezone", "nextRunAt", "status",
      "payloadKind", "message", "deliveryMode", "maxAttempts", "timeoutMs",
      "attemptCount", "createdAt", "updatedAt"
    ) VALUES (
      'existing-job', 'guild-job', 'channel-job', 'thread-job', 'trusted-user',
      'Existing job', 'at', '2026-08-10T12:00:00.000Z', 'UTC',
      '2026-08-10T12:00:00.000Z', 'active', 'message',
      'existing preserved message', 'discord', 4, 42000, 1,
      '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z'
    );

    INSERT INTO "AgentJob" (
      "id", "guildId", "channelId", "userId", "name", "scheduleKind",
      "scheduleValue", "timezone", "nextRunAt", "status", "payloadKind",
      "toolId", "toolInput", "deliveryMode", "createdAt", "updatedAt"
    ) VALUES (
      'legacy-manage-task-job', 'guild-job', 'channel-task-source',
      'trusted-user', 'Legacy reminder wrapper', 'at',
      '2026-08-13T12:00:00.000Z', 'UTC', '2026-08-13T12:00:00.000Z',
      'active', 'tool', 'manage-task',
      '{"action":"remind","when":"in 20 minutes","channelId":"channel-reminder","reminderAction":"check the deploy","reminderMessage":"Check the deploy now"}',
      'discord', '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z'
    );

    INSERT INTO "AgentJob" (
      "id", "guildId", "channelId", "threadId", "userId", "name",
      "scheduleKind", "scheduleValue", "timezone", "nextRunAt", "status",
      "payloadKind", "toolId", "toolInput", "deliveryMode", "createdAt",
      "updatedAt"
    ) VALUES (
      'legacy-scheduled-message-job', 'guild-job', 'channel-schedule-source',
      'thread-schedule-source', 'trusted-user', 'Legacy scheduled message',
      'at', '2026-08-13T12:00:00.000Z', 'America/Los_Angeles',
      '2026-08-13T12:00:00.000Z', 'active', 'tool',
      'manage-scheduled-message',
      '{"action":"schedule","channelId":"channel-schedule-target","message":"Weekly legacy announcement","scheduledAt":"2026-08-20T17:30:00.000Z","repeat":"weekly","createdBy":"trusted-user"}',
      'discord', '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z'
    );

    INSERT INTO "AgentJobRun" (
      "id", "jobId", "status", "startedAt", "output", "createdAt"
    ) VALUES (
      'existing-run', 'existing-job', 'completed',
      '2026-08-02T00:00:00.000Z', 'preserved output',
      '2026-08-02T00:00:00.000Z'
    );

    INSERT INTO "ScheduledTask" (
      "id", "guildId", "channelId", "userId", "scheduledAt", "naturalDesc",
      "enabled", "name", "description", "createdAt", "updatedAt"
    ) VALUES (
      41, 'guild-scheduled', 'channel-scheduled', 'trusted-user',
      '2026-08-11T12:00:00.000Z', 'Post the deploy reminder', true,
      'Deploy reminder', 'Legacy one-shot task',
      '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
    );

    INSERT INTO "ScheduledTask" (
      "id", "guildId", "channelId", "userId", "scheduledAt", "naturalDesc",
      "toolId", "toolInput", "enabled", "name", "description", "createdAt",
      "updatedAt"
    ) VALUES (
      42, 'guild-scheduled', 'channel-scheduled', 'trusted-user',
      '2026-08-12T12:00:00.000Z', 'Send the stored legacy message',
      'send-message', '{"content":"Stored legacy reminder content"}', true,
      'Stored message reminder', 'Fallback legacy reminder content',
      '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
    );

    INSERT INTO "AgentMemory" (
      "id", "guildId", "scope", "ownerKey", "channelId", "userId", "key",
      "content", "sourceType", "sourceId", "salience", "createdAt", "updatedAt"
    ) VALUES (
      'legacy-memory', 'guild-legacy', 'channel', 'legacy-owner',
      'channel-legacy', 'trusted-user', 'coffee', 'Jerred likes espresso',
      'discord', 'memory-message', 0.9, '2026-08-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z'
    );

    INSERT INTO "AgentSession" (
      "id", "guildId", "channelId", "threadId", "userId", "label", "status",
      "steeringPolicy", "summary", "createdAt", "updatedAt"
    ) VALUES (
      'legacy-session', 'guild-legacy', 'channel-legacy', 'thread-legacy',
      'trusted-user', 'Legacy session', 'active', 'steer', 'Legacy summary',
      '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
    );

    INSERT INTO "AgentSessionEvent" (
      "id", "sessionId", "role", "eventType", "content", "metadata",
      "createdAt"
    ) VALUES (
      'legacy-event', 'legacy-session', 'user', 'message',
      'Legacy session content', '{"discordMessageId":"legacy-message"}',
      '2026-08-01T00:00:00.000Z'
    );
  `);
}

function readAppliedMigrations(database: Database): string[] {
  return database
    .query<{ migration_name: string }, []>(
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
    )
    .all()
    .map((row) => row.migration_name);
}

function expectPreservedProductRows(database: Database): void {
  expect(
    database
      .query<
        { guildId: string; channelId: string },
        []
      >(`SELECT "guildId", "channelId" FROM "DailyPostConfig" WHERE "id" = 1`)
      .get(),
  ).toEqual({
    guildId: "guild-product",
    channelId: "channel-product",
  });
  expect(
    database
      .query<
        { messageId: string; question: string },
        []
      >(`SELECT "messageId", "question" FROM "PollRecord" WHERE "id" = 1`)
      .get(),
  ).toEqual({
    messageId: "poll-message",
    question: "Ship Birmel 3?",
  });
}

function expectPreservedJobRows(database: Database): void {
  expect(
    database
      .query<
        {
          actorUserId: string;
          sourceChannelId: string | null;
          message: string | null;
          maxAttempts: number;
          timeoutMs: number;
        },
        []
      >(
        `SELECT "actorUserId", "sourceChannelId", "message", "maxAttempts", "timeoutMs" FROM "AgentJob" WHERE "id" = 'existing-job'`,
      )
      .get(),
  ).toEqual({
    actorUserId: "trusted-user",
    sourceChannelId: "channel-job",
    message: "existing preserved message",
    maxAttempts: 4,
    timeoutMs: 42_000,
  });
  const migratedManageTask = database
    .query<
      {
        payloadKind: string;
        toolId: string | null;
        toolInput: string | null;
        agentPrompt: string | null;
        sourceChannelId: string | null;
      },
      []
    >(
      `SELECT "payloadKind", "toolId", "toolInput", "agentPrompt", "sourceChannelId" FROM "AgentJob" WHERE "id" = 'legacy-manage-task-job'`,
    )
    .get();
  expect(migratedManageTask).toMatchObject({
    payloadKind: "agent",
    toolId: null,
    toolInput: null,
    sourceChannelId: "channel-task-source",
  });
  expect(migratedManageTask?.agentPrompt).toContain(
    "migrated legacy manage-task operation",
  );
  expect(migratedManageTask?.agentPrompt).toContain(
    '"reminderMessage":"Check the deploy now"',
  );
  expect(
    database
      .query<
        {
          channelId: string | null;
          threadId: string | null;
          sourceChannelId: string | null;
          scheduleKind: string;
          scheduleValue: string;
          timezone: string;
          nextRunAt: string | null;
          payloadKind: string;
          message: string | null;
          toolId: string | null;
          toolInput: string | null;
          agentPrompt: string | null;
        },
        []
      >(
        `SELECT "channelId", "threadId", "sourceChannelId", "scheduleKind", "scheduleValue", "timezone", "nextRunAt", "payloadKind", "message", "toolId", "toolInput", "agentPrompt" FROM "AgentJob" WHERE "id" = 'legacy-scheduled-message-job'`,
      )
      .get(),
  ).toEqual({
    channelId: "channel-schedule-target",
    threadId: null,
    sourceChannelId: "channel-schedule-source",
    scheduleKind: "every",
    scheduleValue: "1w",
    timezone: "UTC",
    nextRunAt: "2026-08-20T17:30:00.000Z",
    payloadKind: "message",
    message: "Weekly legacy announcement",
    toolId: null,
    toolInput: null,
    agentPrompt: null,
  });
  expect(
    database
      .query<
        CountRow,
        []
      >(`SELECT COUNT(*) AS count FROM "AgentJob" WHERE "toolId" IN ('manage-task', 'manage-scheduled-message')`)
      .get()?.count,
  ).toBe(0);
  expect(
    database
      .query<
        { jobId: string; output: string | null },
        []
      >(`SELECT "jobId", "output" FROM "AgentJobRun" WHERE "id" = 'existing-run'`)
      .get(),
  ).toEqual({
    jobId: "existing-job",
    output: "preserved output",
  });
  expect(
    database
      .query<
        {
          actorUserId: string;
          payloadKind: string;
          message: string | null;
          legacyTaskId: number | null;
          status: string;
        },
        []
      >(
        `SELECT "actorUserId", "payloadKind", "message", "legacyTaskId", "status" FROM "AgentJob" WHERE "legacyTaskId" = 41`,
      )
      .get(),
  ).toEqual({
    actorUserId: "trusted-user",
    payloadKind: "message",
    message: "Post the deploy reminder",
    legacyTaskId: 41,
    status: "active",
  });
  expect(
    database
      .query<
        {
          payloadKind: string;
          message: string | null;
          toolId: string | null;
          toolInput: string | null;
          legacyTaskId: number | null;
          status: string;
        },
        []
      >(
        `SELECT "payloadKind", "message", "toolId", "toolInput", "legacyTaskId", "status" FROM "AgentJob" WHERE "legacyTaskId" = 42`,
      )
      .get(),
  ).toEqual({
    payloadKind: "message",
    message: "Stored legacy reminder content",
    toolId: null,
    toolInput: null,
    legacyTaskId: 42,
    status: "active",
  });
}

function expectArchivedLegacyRows(database: Database): void {
  const archivedRows = database
    .query<
      { sourceTable: string; sourceId: string; payload: string },
      []
    >(`SELECT "sourceTable", "sourceId", "payload" FROM "LegacyAgentRuntimeArchive" ORDER BY "sourceTable"`)
    .all();
  expect(
    archivedRows.map((row) => ({
      sourceTable: row.sourceTable,
      sourceId: row.sourceId,
    })),
  ).toEqual([
    { sourceTable: "AgentMemory", sourceId: "legacy-memory" },
    { sourceTable: "AgentSession", sourceId: "legacy-session" },
    { sourceTable: "AgentSessionEvent", sourceId: "legacy-event" },
  ]);
  expect(archivedRows[0]?.payload).toContain("Jerred likes espresso");
  expect(archivedRows[1]?.payload).toContain("Legacy summary");
  expect(archivedRows[2]?.payload).toContain("Legacy session content");

  expect(
    database
      .query<CountRow, []>(`SELECT COUNT(*) AS count FROM "AgentSession"`)
      .get()?.count,
  ).toBe(0);
  expect(
    database
      .query<CountRow, []>(`SELECT COUNT(*) AS count FROM "AgentSessionEvent"`)
      .get()?.count,
  ).toBe(0);
  expect(readDatabaseFingerprint(database).tables).not.toContain("AgentMemory");
  expect(readDatabaseFingerprint(database).tables).not.toContain(
    "ScheduledTask",
  );
}

describe("Birmel database migrations", () => {
  test("an empty database applies every committed migration and matches the final Prisma schema", async () => {
    await withTemporaryDatabase(async (databasePath) => {
      await runMigrationBootstrap(databasePath);

      const database = openDatabase(databasePath);
      try {
        expectFinalSchema(database, true);
        expect(readAppliedMigrations(database)).toEqual([
          ...REQUIRED_MIGRATIONS,
        ]);
      } finally {
        database.close();
      }

      await expectPrismaSchemaMatch(databasePath);
    });
  }, 30_000);

  test("a production-shaped database is baselined and migrated without losing product, job, scheduled-task, or legacy archive data", async () => {
    await withTemporaryDatabase(async (databasePath) => {
      const productionDatabase = openDatabase(databasePath);
      try {
        productionDatabase.run(BASELINE_SQL);
        const fingerprint = readDatabaseFingerprint(productionDatabase);
        expect(fingerprint.hasMigrationTable).toBeFalse();
        expect(() => verifyBaselineFingerprint(fingerprint)).not.toThrow();
        seedProductionShapedRows(productionDatabase);
      } finally {
        productionDatabase.close();
      }

      await runMigrationBootstrap(databasePath);

      const migratedDatabase = openDatabase(databasePath);
      try {
        expectFinalSchema(migratedDatabase, true);
        expectPreservedProductRows(migratedDatabase);
        expectPreservedJobRows(migratedDatabase);
        expectArchivedLegacyRows(migratedDatabase);
        expect(readAppliedMigrations(migratedDatabase)).toEqual([
          ...REQUIRED_MIGRATIONS,
        ]);
      } finally {
        migratedDatabase.close();
      }

      await expectPrismaSchemaMatch(databasePath);
    });
  }, 30_000);

  test("a production-shaped database with the verified pre-squash migration history resolves the new baseline and migrates", async () => {
    await withTemporaryDatabase(async (databasePath) => {
      const productionDatabase = openDatabase(databasePath);
      try {
        productionDatabase.run(BASELINE_SQL);
        seedLegacyMigrationHistory(productionDatabase);
        seedProductionShapedRows(productionDatabase);

        const fingerprint = readDatabaseFingerprint(productionDatabase);
        expect(fingerprint.hasMigrationTable).toBeTrue();
        expect(() => verifyBaselineFingerprint(fingerprint)).not.toThrow();
        expect(readAppliedMigrations(productionDatabase)).toEqual(
          LEGACY_BASELINE_MIGRATIONS.map(
            (migration) => migration.migrationName,
          ),
        );
      } finally {
        productionDatabase.close();
      }

      await runMigrationBootstrap(databasePath);

      const migratedDatabase = openDatabase(databasePath);
      try {
        expectFinalSchema(migratedDatabase, true);
        expectPreservedProductRows(migratedDatabase);
        expectPreservedJobRows(migratedDatabase);
        expectArchivedLegacyRows(migratedDatabase);
        expect(readAppliedMigrations(migratedDatabase)).toEqual([
          ...LEGACY_BASELINE_MIGRATIONS.map(
            (migration) => migration.migrationName,
          ),
          ...REQUIRED_MIGRATIONS,
        ]);
      } finally {
        migratedDatabase.close();
      }

      await expectPrismaSchemaMatch(databasePath);
    });
  }, 30_000);

  test("a database with legacy migration history is fingerprinted before the new baseline is resolved", async () => {
    await withTemporaryDatabase(async (databasePath) => {
      const database = openDatabase(databasePath);
      try {
        database.run(BASELINE_SQL);
        database.run(
          `CREATE TABLE "UnexpectedLegacyTable" ("id" INTEGER NOT NULL PRIMARY KEY)`,
        );
        seedLegacyMigrationHistory(database);
      } finally {
        database.close();
      }

      await expect(runMigrationBootstrap(databasePath)).rejects.toThrow(
        /table fingerprint.*UnexpectedLegacyTable/,
      );

      const rejectedDatabase = openDatabase(databasePath);
      try {
        expect(readAppliedMigrations(rejectedDatabase)).not.toContain(
          REQUIRED_MIGRATIONS[0],
        );
      } finally {
        rejectedDatabase.close();
      }
    });
  }, 30_000);

  test("an unverified legacy migration history cannot resolve the new baseline", async () => {
    await withTemporaryDatabase(async (databasePath) => {
      const database = openDatabase(databasePath);
      try {
        database.run(BASELINE_SQL);
        seedLegacyMigrationHistory(database, [
          ...LEGACY_BASELINE_MIGRATIONS,
          {
            migrationName: "20260701000000_unknown_legacy_change",
            checksum: "unknown-checksum",
          },
        ]);
      } finally {
        database.close();
      }

      await expect(runMigrationBootstrap(databasePath)).rejects.toThrow(
        /migration history is not the verified pre-squash history/,
      );

      const rejectedDatabase = openDatabase(databasePath);
      try {
        expect(readAppliedMigrations(rejectedDatabase)).not.toContain(
          REQUIRED_MIGRATIONS[0],
        );
      } finally {
        rejectedDatabase.close();
      }
    });
  }, 30_000);

  test("a production database with a mismatched fingerprint is rejected", async () => {
    await withTemporaryDatabase((databasePath) => {
      const database = openDatabase(databasePath);
      try {
        database.run(BASELINE_SQL);
        database.run(
          `CREATE TABLE "UnexpectedLegacyTable" ("id" INTEGER NOT NULL PRIMARY KEY)`,
        );

        expect(() =>
          verifyBaselineFingerprint(readDatabaseFingerprint(database)),
        ).toThrow(/table fingerprint.*UnexpectedLegacyTable/);
      } finally {
        database.close();
      }
    });
  });

  test("AgentRun cannot persist assembled prompt-like content", async () => {
    await withTemporaryDatabase((databasePath) => {
      const database = openDatabase(databasePath);
      try {
        database.run(BASELINE_SQL);
        database.run(RUNTIME_SQL);
        expectFinalSchema(database, false);

        const agentRunColumns = tableColumns(database, "AgentRun");
        expect(agentRunColumns).not.toContain("assembledPrompt");
        expect(agentRunColumns).not.toContain("prompt");
        expect(agentRunColumns).not.toContain("systemPrompt");
        expect(agentRunColumns).not.toContain("messages");
        expect(agentRunColumns).not.toContain("contextBundle");
        expect(agentRunColumns).not.toContain("requestContent");
        expect(agentRunColumns).not.toContain("responseContent");
        expect(agentRunColumns).not.toContain("memoryContent");

        const schema = database
          .query<
            SchemaRow,
            []
          >(`SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'AgentRun'`)
          .get();
        expect(schema?.sql).not.toMatch(/\b(prompt|content|contextBundle)\b/i);
      } finally {
        database.close();
      }
    });
  });
});
