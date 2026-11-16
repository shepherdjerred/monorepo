import { z } from "zod";
import {
  postgresBinaryPath,
  runCommandAsync,
  runCommandSync,
} from "./binaries.ts";
import {
  decideStaleTemplatePrune,
  decideSweep,
  hostProcessProbe,
  parseOwnerComment,
  type OwnerRecord,
  type ProcessProbe,
} from "./owner.ts";
import { ensureSharedPostgres } from "./server.ts";

function buildPsqlMaintenanceArgv(
  commands: readonly string[],
  adminUrl?: string,
): string[] {
  const allowAnyMajor = adminUrl !== undefined;
  const psql = postgresBinaryPath("psql", { allowAnyMajor });
  const targetUrl = adminUrl ?? ensureSharedPostgres().superUrl;
  const argv = [
    psql,
    "--no-psqlrc",
    "--dbname",
    targetUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-At",
  ];
  for (const sql of commands) {
    argv.push("-c", sql);
  }
  return argv;
}

export function psqlMaintenanceCommands(
  commands: readonly string[],
  options?: { readonly adminUrl?: string | undefined },
): string {
  const result = runCommandSync(
    buildPsqlMaintenanceArgv(commands, options?.adminUrl),
  );
  if (result.exitCode !== 0) {
    throw new Error(`psql failed (${commands.join("; ")}): ${result.stderr}`);
  }
  return result.stdout.trim();
}

export async function psqlMaintenanceCommandsAsync(
  commands: readonly string[],
  options?: { readonly adminUrl?: string | undefined },
): Promise<string> {
  const result = await runCommandAsync(
    buildPsqlMaintenanceArgv(commands, options?.adminUrl),
  );
  if (result.exitCode !== 0) {
    throw new Error(`psql failed (${commands.join("; ")}): ${result.stderr}`);
  }
  return result.stdout.trim();
}

export function psqlMaintenance(
  sql: string,
  options?: { readonly adminUrl?: string | undefined },
): string {
  return psqlMaintenanceCommands([sql], options);
}

export function ensureDatabase(dbName: string): void {
  const { superUrl } = ensureSharedPostgres();
  const exists = psqlMaintenance(
    `SELECT 1 FROM pg_database WHERE datname = '${dbName.replaceAll("'", "''")}'`,
    { adminUrl: superUrl },
  );
  if (exists === "1") return;
  try {
    psqlMaintenance(`CREATE DATABASE "${dbName}"`, { adminUrl: superUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("already exists")) {
      throw error;
    }
  }
}

export const TEST_DATABASE_PREFIXES = [
  "scout",
  "delivery",
  "media",
  "tracker",
] as const;

export type TestDatabasePrefix = (typeof TEST_DATABASE_PREFIXES)[number];

export const LOCK_TIMEOUT_SQL = "SET lock_timeout = '250ms'";

export function templateCloneSharedLockSql(templateName: string): string {
  const escaped = templateName.replaceAll("'", "''");
  return `SELECT pg_advisory_lock_shared(hashtext('monorepo-test-postgres'), hashtext('template-prune:${escaped}'))`;
}

export function templateCloneSharedUnlockSql(templateName: string): string {
  const escaped = templateName.replaceAll("'", "''");
  return `SELECT pg_advisory_unlock_shared(hashtext('monorepo-test-postgres'), hashtext('template-prune:${escaped}'))`;
}

function templatePruneExclusiveTryLockSql(templateName: string): string {
  const escaped = templateName.replaceAll("'", "''");
  return `DO $$ BEGIN IF NOT pg_try_advisory_lock(hashtext('monorepo-test-postgres'), hashtext('template-prune:${escaped}')) THEN RAISE EXCEPTION 'template busy'; END IF; END $$`;
}

const DatabaseRowSchema = z.array(
  z.strictObject({
    name: z.string(),
    comment: z.string().nullable(),
    isTemplate: z.boolean(),
    allowConnections: z.boolean(),
    connections: z.number().int().nonnegative(),
  }),
);

export type ListedDatabaseRow = {
  readonly name: string;
  readonly record: OwnerRecord;
  readonly isTemplate: boolean;
  readonly allowConnections: boolean;
  readonly connections: number;
};

function listDatabasesQuery(whereClause: string): string {
  return (
    `SELECT coalesce(json_agg(json_build_object(` +
    `'name', d.datname, ` +
    `'comment', shobj_description(d.oid, 'pg_database'), ` +
    `'isTemplate', d.datistemplate, ` +
    `'allowConnections', d.datallowconn, ` +
    `'connections', (SELECT count(*) FROM pg_stat_activity a WHERE a.datid = d.oid AND a.pid <> pg_backend_pid())` +
    `)), '[]') FROM pg_database d WHERE ${whereClause}`
  );
}

function parseListedDatabaseRows(rawJson: string): ListedDatabaseRow[] {
  return DatabaseRowSchema.parse(JSON.parse(rawJson)).map((row) => ({
    name: row.name,
    record: parseOwnerComment(row.comment),
    isTemplate: row.isTemplate,
    allowConnections: row.allowConnections,
    connections: row.connections,
  }));
}

export function listManagedDatabases(
  whereClause: string,
  options?: { readonly adminUrl?: string | undefined },
): ListedDatabaseRow[] {
  return parseListedDatabaseRows(
    psqlMaintenance(listDatabasesQuery(whereClause), options),
  );
}

export async function listManagedDatabasesAsync(
  whereClause: string,
  options?: { readonly adminUrl?: string | undefined },
): Promise<ListedDatabaseRow[]> {
  const raw = await psqlMaintenanceCommandsAsync(
    [listDatabasesQuery(whereClause)],
    options,
  );
  return parseListedDatabaseRows(raw);
}

export type SweepOptions = {
  readonly adminUrl?: string | undefined;
  readonly prefixes?: readonly TestDatabasePrefix[];
  readonly now?: number;
  readonly graceMs?: number;
  readonly probe?: ProcessProbe;
};

export type SweepSummary = {
  readonly dropped: readonly string[];
  readonly keptUnowned: readonly string[];
  readonly keptActiveConnections: readonly string[];
};

function tryDropDatabaseNonBlocking(
  dbName: string,
  options?: { readonly adminUrl?: string | undefined },
): boolean {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      psqlMaintenanceCommands(
        [LOCK_TIMEOUT_SQL, `DROP DATABASE IF EXISTS "${dbName}"`],
        options,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 3 || !message.includes("lock timeout")) {
        return false;
      }
      Bun.sleepSync(150);
    }
  }
  return false;
}

function buildSweepWhereClause(
  prefixes: readonly TestDatabasePrefix[],
): string {
  const group = prefixes.join("|");
  return `d.datname ~ '^(${group})_(test|mig)_'`;
}

/**
 * Sweeps dead-owner `*_test_*` and `*_mig_*` databases across all managed
 * prefixes (`scout_`, `delivery_`, `media_`, `tracker_`) whose owner host
 * matches this host, whose `(pid, processStart)` has exited, and which have
 * zero active connections, using non-blocking `SET lock_timeout = '250ms'`.
 */
export function sweepStaleTestDatabases(
  options: SweepOptions = {},
): SweepSummary {
  const prefixes = options.prefixes ?? TEST_DATABASE_PREFIXES;
  const now = options.now ?? Date.now();
  const probe = options.probe ?? hostProcessProbe;
  const rows = listManagedDatabases(buildSweepWhereClause(prefixes), {
    adminUrl: options.adminUrl,
  });

  const dropped: string[] = [];
  const keptUnowned: string[] = [];
  const keptActiveConnections: string[] = [];

  for (const row of rows) {
    const decision = decideSweep({
      record: row.record,
      activeConnections: row.connections,
      now,
      probe,
      ...(options.graceMs === undefined ? {} : { graceMs: options.graceMs }),
    });
    if (decision.action === "keep") {
      if (
        decision.reason === "unowned" ||
        decision.reason === "malformed-owner"
      ) {
        keptUnowned.push(row.name);
      } else if (decision.reason === "active-connections") {
        keptActiveConnections.push(row.name);
      }
      continue;
    }
    if (tryDropDatabaseNonBlocking(row.name, { adminUrl: options.adminUrl })) {
      dropped.push(row.name);
    }
  }

  return { dropped, keptUnowned, keptActiveConnections };
}

const sweptMaintenanceTargets = new Set<string>();

/**
 * Runs the stale-database sweep at most once per maintenance target in the
 * current process so parallel tests never stampede `pg_database`.
 */
export function sweepStaleTestDatabasesOnce(options?: {
  readonly adminUrl?: string | undefined;
}): void {
  const target = options?.adminUrl ?? ensureSharedPostgres().superUrl;
  if (sweptMaintenanceTargets.has(target)) return;
  sweptMaintenanceTargets.add(target);
  sweepStaleTestDatabases({ adminUrl: target });
}

export async function pruneStaleTemplateDatabases(options: {
  readonly prefix: TestDatabasePrefix;
  readonly currentTemplateName: string;
  readonly adminUrl?: string | undefined;
  readonly now?: number;
  readonly maxAgeMs?: number;
  readonly probe?: ProcessProbe;
}): Promise<readonly string[]> {
  const rows = await listManagedDatabasesAsync(
    String.raw`d.datname LIKE '${options.prefix}\_template\_%'`,
    { adminUrl: options.adminUrl },
  );
  const now = options.now ?? Date.now();
  const probe = options.probe ?? hostProcessProbe;
  const pruned: string[] = [];

  for (const row of rows) {
    const decision = decideStaleTemplatePrune({
      databaseName: row.name,
      currentTemplateName: options.currentTemplateName,
      record: row.record,
      activeConnections: row.connections,
      now,
      probe,
      ...(options.maxAgeMs === undefined ? {} : { maxAgeMs: options.maxAgeMs }),
    });
    if (decision.action !== "drop") {
      continue;
    }
    try {
      const tryLock = templatePruneExclusiveTryLockSql(row.name);
      const commands = row.isTemplate
        ? [
            LOCK_TIMEOUT_SQL,
            tryLock,
            `ALTER DATABASE "${row.name}" WITH IS_TEMPLATE FALSE`,
            `DROP DATABASE IF EXISTS "${row.name}"`,
          ]
        : [LOCK_TIMEOUT_SQL, tryLock, `DROP DATABASE IF EXISTS "${row.name}"`];
      await psqlMaintenanceCommandsAsync(commands, {
        adminUrl: options.adminUrl,
      });
      pruned.push(row.name);
    } catch {
      // Another worktree or test may have touched it concurrently; keep safely.
    }
  }
  return pruned;
}
