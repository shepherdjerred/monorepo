import { Database } from "bun:sqlite";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const BASELINE_MIGRATION = "20260808000000_baseline";
export const REQUIRED_MIGRATIONS = [
  BASELINE_MIGRATION,
  "20260808010000_birmel_3_runtime",
] as const;

export const LEGACY_BASELINE_MIGRATIONS = [
  {
    migrationName: "20251222203142_add_polls_activity_birthdays",
    checksum:
      "53d4ab1b63581bd6b502699cb59b9e9b453697c84fb6f6ab4c91099730238443",
  },
  {
    migrationName: "20251223072521_add_scheduled_task",
    checksum:
      "44ba8134535f1552fdfad47c44a79b7e5e29db73b9d9edabda6d3bd4aafbc19e",
  },
  {
    migrationName: "20260603000000_add_agent_runtime_capabilities",
    checksum:
      "a4d3c27d3934e7da90e715d2342db073da351a8c488c2c1422efa4f31d65df82",
  },
] as const;

const EXPECTED_BASELINE_TABLES = [
  "AgentJob",
  "AgentJobRun",
  "AgentMemory",
  "AgentSession",
  "AgentSessionEvent",
  "Birthday",
  "DailyPostConfig",
  "EditorSession",
  "ElectionPoll",
  "GitHubAuth",
  "GuildOwner",
  "MusicHistory",
  "PollRecord",
  "ScheduledAnnouncement",
  "ScheduledTask",
  "ServerEvent",
  "UserActivity",
] as const;

const EXPECTED_BASELINE_INDEXES = [
  "AgentJobRun_jobId_startedAt_idx",
  "AgentJobRun_status_startedAt_idx",
  "AgentJob_channelId_idx",
  "AgentJob_guildId_status_idx",
  "AgentJob_legacyTaskId_key",
  "AgentJob_status_nextRunAt_idx",
  "AgentJob_threadId_idx",
  "AgentMemory_channelId_idx",
  "AgentMemory_guildId_scope_idx",
  "AgentMemory_sessionId_idx",
  "AgentMemory_updatedAt_idx",
  "AgentMemory_userId_idx",
  "AgentSessionEvent_eventType_createdAt_idx",
  "AgentSessionEvent_sessionId_createdAt_idx",
  "AgentSession_channelId_status_idx",
  "AgentSession_guildId_status_idx",
  "AgentSession_threadId_status_idx",
  "AgentSession_userId_status_idx",
  "Birthday_guildId_birthMonth_birthDay_idx",
  "Birthday_userId_guildId_key",
  "DailyPostConfig_guildId_key",
  "EditorSession_guildId_idx",
  "EditorSession_threadId_idx",
  "EditorSession_userId_state_idx",
  "ElectionPoll_guildId_status_idx",
  "ElectionPoll_scheduledStart_idx",
  "GitHubAuth_userId_key",
  "GuildOwner_guildId_key",
  "MusicHistory_guildId_createdAt_idx",
  "PollRecord_guildId_createdAt_idx",
  "PollRecord_messageId_key",
  "ScheduledAnnouncement_guildId_idx",
  "ScheduledAnnouncement_scheduledAt_idx",
  "ScheduledTask_enabled_scheduledAt_idx",
  "ScheduledTask_guildId_idx",
  "ServerEvent_guildId_createdAt_idx",
  "UserActivity_guildId_activityType_createdAt_idx",
  "UserActivity_guildId_userId_createdAt_idx",
] as const;

const SchemaNameRowSchema = z.object({ name: z.string() });
const SchemaNameRowsSchema = z.array(SchemaNameRowSchema);
const MigrationHistoryRowSchema = z.object({
  migrationName: z.string(),
  checksum: z.string(),
  isFinished: z.union([z.literal(0), z.literal(1)]),
  isRolledBack: z.union([z.literal(0), z.literal(1)]),
});
const MigrationHistoryRowsSchema = z.array(MigrationHistoryRowSchema);

type MigrationHistoryRow = z.infer<typeof MigrationHistoryRowSchema>;

export type DatabaseFingerprint = {
  tables: string[];
  indexes: string[];
  hasMigrationTable: boolean;
};

function sorted(values: readonly string[]): string[] {
  return [...values].toSorted((left, right) => left.localeCompare(right));
}

function describeDifference(
  expected: readonly string[],
  actual: readonly string[],
): string {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((value) => !actualSet.has(value));
  const unexpected = actual.filter((value) => !expectedSet.has(value));
  return JSON.stringify({ missing, unexpected });
}

export function verifyBaselineFingerprint(
  fingerprint: DatabaseFingerprint,
): void {
  const expectedTables = sorted(EXPECTED_BASELINE_TABLES);
  const expectedIndexes = sorted(EXPECTED_BASELINE_INDEXES);
  const actualTables = sorted(fingerprint.tables);
  const actualIndexes = sorted(fingerprint.indexes);

  if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) {
    throw new Error(
      `Existing Birmel database table fingerprint does not match the baseline: ${describeDifference(expectedTables, actualTables)}`,
    );
  }
  if (JSON.stringify(actualIndexes) !== JSON.stringify(expectedIndexes)) {
    throw new Error(
      `Existing Birmel database index fingerprint does not match the baseline: ${describeDifference(expectedIndexes, actualIndexes)}`,
    );
  }
}

export function readDatabaseFingerprint(
  database: Database,
): DatabaseFingerprint {
  const tables = SchemaNameRowsSchema.parse(
    database
      .query<
        { name: string },
        []
      >("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all(),
  ).map((row) => row.name);
  const indexes = SchemaNameRowsSchema.parse(
    database
      .query<
        { name: string },
        []
      >("SELECT name FROM sqlite_schema WHERE type = 'index' AND sql IS NOT NULL ORDER BY name")
      .all(),
  ).map((row) => row.name);
  return {
    tables: tables.filter((name) => name !== "_prisma_migrations"),
    indexes,
    hasMigrationTable: tables.includes("_prisma_migrations"),
  };
}

function readMigrationHistory(database: Database): MigrationHistoryRow[] {
  return MigrationHistoryRowsSchema.parse(
    database
      .query<
        {
          migrationName: string;
          checksum: string;
          isFinished: number;
          isRolledBack: number;
        },
        []
      >(
        `
        SELECT
          "migration_name" AS "migrationName",
          "checksum",
          ("finished_at" IS NOT NULL) AS "isFinished",
          ("rolled_back_at" IS NOT NULL) AS "isRolledBack"
        FROM "_prisma_migrations"
        ORDER BY "migration_name", "started_at", "id"
      `,
      )
      .all(),
  );
}

function hasAppliedMigration(
  history: readonly MigrationHistoryRow[],
  migrationName: string,
): boolean {
  return history.some(
    (migration) =>
      migration.migrationName === migrationName &&
      migration.isFinished === 1 &&
      migration.isRolledBack === 0,
  );
}

function verifyLegacyMigrationHistory(
  history: readonly MigrationHistoryRow[],
): void {
  const expected = LEGACY_BASELINE_MIGRATIONS.map((migration) => ({
    migrationName: migration.migrationName,
    checksum: migration.checksum,
    isFinished: 1,
    isRolledBack: 0,
  }));
  if (JSON.stringify(history) !== JSON.stringify(expected)) {
    throw new Error(
      `Existing Birmel database migration history is not the verified pre-squash history: ${JSON.stringify({ expected: expected.map((migration) => migration.migrationName), actual: history.map((migration) => migration.migrationName) })}`,
    );
  }
}

export function databasePathFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const configured =
    environment["DATABASE_URL"] ??
    environment["DATABASE_PATH"] ??
    "file:./data/birmel.db";
  const withoutPrefix = configured.startsWith("file:")
    ? configured.slice("file:".length)
    : configured;
  const path = withoutPrefix.split("?", 1)[0];
  if (path == null || path.length === 0 || path.includes("://")) {
    throw new Error(
      "Birmel requires a local SQLite DATABASE_URL or DATABASE_PATH",
    );
  }
  return path;
}

async function runPrisma(prismaArguments: string[]): Promise<void> {
  const child = Bun.spawn(["bunx", "--trust", "prisma", ...prismaArguments], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(
      `prisma ${prismaArguments.join(" ")} exited with code ${String(exitCode)}`,
    );
  }
}

export async function deployDatabaseMigrations(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): Promise<void> {
  const database = new Database(databasePathFromEnvironment(environment), {
    create: true,
    strict: true,
  });
  let shouldResolveBaseline = false;
  try {
    const fingerprint = readDatabaseFingerprint(database);
    if (!fingerprint.hasMigrationTable && fingerprint.tables.length > 0) {
      verifyBaselineFingerprint(fingerprint);
      shouldResolveBaseline = true;
    } else if (fingerprint.hasMigrationTable) {
      const migrationHistory = readMigrationHistory(database);
      if (!hasAppliedMigration(migrationHistory, BASELINE_MIGRATION)) {
        verifyBaselineFingerprint(fingerprint);
        verifyLegacyMigrationHistory(migrationHistory);
        shouldResolveBaseline = true;
      }
    }
  } finally {
    database.close();
  }

  if (shouldResolveBaseline) {
    await runPrisma(["migrate", "resolve", "--applied", BASELINE_MIGRATION]);
  }
  await runPrisma(["migrate", "deploy"]);
}
