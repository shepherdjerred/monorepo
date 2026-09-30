#!/usr/bin/env bun
/**
 * Copy a hosted Scout Postgres database into local dev.
 *
 *   bun run dev:db-pull
 *   bun run dev:db-pull -- --stage prod --database scout_prod_snapshot
 *
 * None of the homelab clusters is reachable without `kubectl`, so the dump runs
 * inside the pod over the local trust socket the cluster's pgHba grants for
 * exactly these runbooks. Every decision this makes lives in
 * `dev-db-pull-plan.ts`; this file only performs them.
 *
 * The local database is dropped and recreated each run. Migrations are left to
 * `dev:web`, which applies anything newer than the snapshot when it boots.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { captureCommand } from "@shepherdjerred/toolkit/lib/postgres/command.ts";
import {
  execInPod,
  execInPodToFile,
  findReadyMasterPod,
  pgBinaryPath,
  serverMajorVersion,
} from "@shepherdjerred/toolkit/lib/postgres/pod.ts";

import {
  assertRedacted,
  assertRestorableVersions,
  assertRestoredTables,
  copyInStatement,
  EXCLUDED_TABLE_DATA,
  redactedCopyOutStatement,
  redactionCheckStatement,
  REDACTED_COLUMNS,
  RESTORE_SECTIONS,
  type ColumnRedaction,
  dumpArgv,
  handoffMessage,
  parseClientMajorVersion,
  parseDevDbPullArgs,
  localDatabaseUrl,
  parseRowList,
  restoreArgv,
  selectDumpableExtensions,
  USAGE,
  type DevDbPullOptions,
  type StageTarget,
} from "./dev-db-pull-plan.ts";

const SOURCE_EXTENSIONS = "SELECT extname FROM pg_extension ORDER BY extname";
const AVAILABLE_EXTENSIONS =
  "SELECT name FROM pg_available_extensions ORDER BY name";
const PUBLIC_TABLES = `SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name`;

function columnsQuery(table: string): string {
  return `SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = '${table}'
    ORDER BY ordinal_position`;
}

/**
 * Re-materialize one table's rows with its credential columns blanked.
 *
 * The dump deliberately carries no data for these tables, so the rows arrive
 * here already redacted at the source. Nothing writes a live token to this
 * machine at any point.
 */
async function copyRedactedTable(
  options: DevDbPullOptions,
  pod: string,
  table: string,
  redactions: readonly ColumnRedaction[],
): Promise<number> {
  const target = options.target;
  const columns = parseRowList(
    await queryLocal(options.databaseUrl, columnsQuery(table)),
  );
  const rows = await queryPod(
    target,
    pod,
    redactedCopyOutStatement(table, columns, redactions),
  );
  const loader = Bun.spawn(
    [
      "psql",
      options.databaseUrl,
      "--quiet",
      "--variable",
      "ON_ERROR_STOP=1",
      "--command",
      copyInStatement(table, columns),
    ],
    { stdin: new Blob([rows]), stdout: "pipe", stderr: "pipe" },
  );
  const [stderr, exitCode] = await Promise.all([
    new Response(loader.stderr).text(),
    loader.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Loading redacted ${table} rows exited ${String(exitCode)}: ${stderr.trim()}`,
    );
  }
  const counts = parseRowList(
    await queryLocal(
      options.databaseUrl,
      redactionCheckStatement(table, redactions),
    ),
  );
  const [row] = counts;
  const values = (row ?? "").split("|").map(Number);
  assertRedacted(
    table,
    Object.fromEntries(
      redactions.map((redaction, index) => [
        redaction.column,
        values[index] ?? 0,
      ]),
    ),
  );
  return rows.split("\n").filter((line) => line.length > 0).length;
}

async function queryLocal(databaseUrl: string, sql: string): Promise<string> {
  return captureCommand({
    args: [
      "psql",
      databaseUrl,
      "--no-align",
      "--tuples-only",
      "--variable",
      "ON_ERROR_STOP=1",
      "--command",
      sql,
    ],
    label: "psql",
  });
}

async function queryPod(
  target: StageTarget,
  pod: string,
  sql: string,
): Promise<string> {
  return execInPod({
    namespace: target.namespace,
    pod,
    container: target.container,
    command: [
      "psql",
      "--username",
      "postgres",
      "--dbname",
      target.database,
      "--no-align",
      "--tuples-only",
      "--variable",
      "ON_ERROR_STOP=1",
      "--command",
      sql,
    ],
  });
}

async function ensureSharedServer(
  scoutRoot: string,
  database: string,
): Promise<void> {
  const ensure = Bun.spawn(
    ["bun", "run", "scripts/ensure-dev-postgres.ts", database],
    {
      cwd: path.join(scoutRoot, "packages", "backend"),
      env: Bun.env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if ((await ensure.exited) !== 0) {
    throw new Error("Failed to start the shared local dev Postgres");
  }
}

async function recreateLocalDatabase(options: DevDbPullOptions): Promise<void> {
  const host = [
    "--host",
    "127.0.0.1",
    "--port",
    localPort(options),
    "--username",
    "scout",
  ];
  // --force terminates whatever is still attached. A dev:web left running
  // against the previous snapshot otherwise fails the drop outright, which
  // would make a re-pull depend on remembering to stop the app first.
  await captureCommand({
    args: ["dropdb", ...host, "--force", "--if-exists", options.localDatabase],
    label: "dropdb",
  });
  await captureCommand({
    args: ["createdb", ...host, options.localDatabase],
    label: "createdb",
  });
  // `createdb` supplies a `public` schema, and the dump carries its own
  // `CREATE SCHEMA public`. Under --single-transaction that collision rolls
  // back the entire restore, so drop it before restoring.
  await queryLocal(options.databaseUrl, "DROP SCHEMA public CASCADE");
}

function localPort(options: DevDbPullOptions): string {
  const parsed = new URL(options.databaseUrl);
  return parsed.port;
}

async function main(): Promise<void> {
  const parsed = parseDevDbPullArgs(Bun.argv.slice(2), Bun.env);
  if (parsed.kind === "help") {
    console.log(USAGE);
    return;
  }
  const options = parsed.options;
  const target = options.target;
  const scoutRoot = path.resolve(import.meta.dir, "../..");
  const maintenanceUrl = localDatabaseUrl("postgres", Bun.env);

  if (options.stage === "prod") {
    console.warn(
      "WARNING: pulling from production. The restore puts real player data (aliases, Discord IDs, PUUIDs) on this machine.",
    );
  }

  const pod = await findReadyMasterPod({
    namespace: target.namespace,
    cluster: target.cluster,
  });
  console.log(`Source: ${target.namespace}/${pod.name} (${target.database})`);

  const serverMajor = await serverMajorVersion({
    namespace: target.namespace,
    pod: pod.name,
    container: target.container,
    database: target.database,
  });
  const localMajor = parseClientMajorVersion(
    await captureCommand({ args: ["pg_restore", "--version"] }),
  );
  assertRestorableVersions(serverMajor, localMajor);
  // The pod's PATH resolves pg_dump to its newest toolchain, which would write
  // an archive this client cannot read while still exiting 0.
  const dumpBinary = pgBinaryPath(serverMajor, "pg_dump");
  console.log(
    `PostgreSQL ${String(serverMajor)} server, ${String(localMajor)} local client; dumping with ${dumpBinary}`,
  );

  await ensureSharedServer(scoutRoot, options.localDatabase);

  const selection = selectDumpableExtensions(
    parseRowList(await queryPod(target, pod.name, SOURCE_EXTENSIONS)),
    parseRowList(await queryLocal(maintenanceUrl, AVAILABLE_EXTENSIONS)),
  );
  if (selection.skipped.length > 0) {
    console.log(
      `Skipping extensions absent from the local build: ${selection.skipped.join(", ")}`,
    );
  }

  await mkdir(path.dirname(options.dumpPath), { recursive: true });
  const written = await execInPodToFile({
    namespace: target.namespace,
    pod: pod.name,
    container: target.container,
    destination: options.dumpPath,
    command: dumpArgv({
      binaryPath: dumpBinary,
      database: target.database,
      extensions: selection.include,
    }),
  });
  console.log(
    `Dumped ${(written / 1_000_000).toFixed(1)} MB to ${options.dumpPath}`,
  );

  await recreateLocalDatabase(options);
  for (const section of RESTORE_SECTIONS) {
    if (section === "post-data") {
      // Between `data` and `post-data`: the rows the dump withheld have to be
      // present before the foreign keys referencing them are created.
      for (const [table, redactions] of Object.entries(REDACTED_COLUMNS)) {
        const loaded = await copyRedactedTable(
          options,
          pod.name,
          table,
          redactions,
        );
        console.log(
          `Loaded ${String(loaded)} ${table} rows with ${redactions
            .map((redaction) => redaction.column)
            .join(", ")} redacted`,
        );
      }
    }
    await captureCommand({
      args: restoreArgv({
        databaseUrl: options.databaseUrl,
        dumpPath: options.dumpPath,
        section,
      }),
      label: `pg_restore --section=${section}`,
    });
  }
  console.log(
    `Restored no rows for credential-only tables: ${EXCLUDED_TABLE_DATA.join(", ")}`,
  );

  const sourceTables = parseRowList(
    await queryPod(target, pod.name, PUBLIC_TABLES),
  );
  const restoredTables = parseRowList(
    await queryLocal(options.databaseUrl, PUBLIC_TABLES),
  );
  assertRestoredTables(sourceTables, restoredTables);
  console.log(`Restored ${String(restoredTables.length)} tables.`);
  console.log("");
  console.log(handoffMessage(options));
}

if (import.meta.main) {
  await main();
}
