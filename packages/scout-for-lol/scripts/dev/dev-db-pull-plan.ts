/**
 * Decisions behind `dev:db-pull`, kept separate from the shelling-out half so
 * every one of them is testable without a cluster or a local Postgres.
 *
 * Three of this pipeline's steps fail silently if done naively, and each is
 * encoded here rather than left to the operator:
 *
 *  - The source pod carries several PostgreSQL toolchains and `PATH` resolves
 *    to the newest, which writes an archive the local client cannot read while
 *    still exiting 0. `assertRestorableVersions` states the requirement; the
 *    caller pairs it with `pgBinaryPath` from the toolkit helper.
 *  - The hosted database carries monitoring extensions that do not exist in the
 *    mise-pinned local build. `selectDumpableExtensions` keeps them out.
 *  - Omissions are not predicted, they are checked: `assertRestoredTables`
 *    compares the restored tables against the source's.
 */
import { requireCliValue } from "#scripts/migration-core.ts";

const DEFAULT_PG_PORT = "5471";
const LOCAL_DATABASE_PATTERN = /^[a-z][a-z0-9_]*$/;
const CLIENT_VERSION_PATTERN = /(\d+)(?:\.\d+)*$/;

/**
 * Always dumped, never emitted.
 *
 * `pg_dump` treats an `--extension` pattern that matches nothing as a fatal
 * error, so the include list can never be empty. `plpgsql` exists in every
 * database and `pg_dump` emits no statement for it, which makes it a safe
 * anchor for an otherwise-empty selection.
 */
const EXTENSION_ANCHOR = "plpgsql";

export type DevDbPullStage = "beta" | "prod";

export type StageTarget = {
  readonly namespace: string;
  readonly cluster: string;
  readonly container: string;
  readonly database: string;
};

export const STAGES: Readonly<Record<DevDbPullStage, StageTarget>> = {
  beta: {
    namespace: "scout-beta",
    cluster: "scout-beta-postgresql",
    container: "postgres",
    database: "scout",
  },
  prod: {
    namespace: "scout-prod",
    cluster: "scout-prod-postgresql",
    container: "postgres",
    database: "scout",
  },
};

export type DevDbPullOptions = {
  readonly stage: DevDbPullStage;
  readonly target: StageTarget;
  readonly localDatabase: string;
  readonly databaseUrl: string;
  readonly dumpPath: string;
};

export type DevDbPullParseResult =
  | { readonly kind: "help" }
  | { readonly kind: "options"; readonly options: DevDbPullOptions };

export const USAGE = `Usage: bun run dev:db-pull -- [options]

Copies a hosted Scout Postgres database into a local database on the shared dev
server, then prints the dev:web command that uses it.

Options:
  --stage <beta|prod>   Source stage (default: beta)
  --database <name>     Local database name (default: scout_<stage>_snapshot)
  --dump-path <path>    Where to write the intermediate dump
  --help                Show this help

The local database is dropped and recreated on every run. Migrations are not
applied here; dev:web applies them when it boots against the restored database.`;

function parseStage(value: string): DevDbPullStage {
  if (value === "beta" || value === "prod") {
    return value;
  }
  throw new Error(`--stage must be beta or prod, got ${value}`);
}

function parseLocalDatabase(value: string): string {
  if (!LOCAL_DATABASE_PATTERN.test(value)) {
    // dev:web only treats a loopback URL as its own shared server when the
    // name matches this pattern; anything else is silently used as-is, which
    // skips the ensure-and-migrate step the restored database needs.
    throw new Error(
      `--database must match ${LOCAL_DATABASE_PATTERN.source}, got ${value}`,
    );
  }
  return value;
}

/** Local URL for a database on the shared dev Postgres. */
export function localDatabaseUrl(
  database: string,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const port = environment["SCOUT_PG_PORT"] ?? DEFAULT_PG_PORT;
  return `postgres://scout@127.0.0.1:${port}/${database}`;
}

/** Default dump location, alongside the other local Scout dev data. */
export function defaultDumpPath(
  stage: DevDbPullStage,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const dataHome =
    environment["XDG_DATA_HOME"] ??
    `${environment["HOME"] ?? "/tmp"}/.local/share`;
  return `${dataHome}/scout-for-lol/db-pull/${stage}.dump`;
}

export function parseDevDbPullArgs(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): DevDbPullParseResult {
  let stage: DevDbPullStage = "beta";
  let database: string | undefined;
  let dumpPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      return { kind: "help" };
    }
    if (argument === "--stage") {
      stage = parseStage(requireCliValue(args, index, "--stage"));
      index += 1;
      continue;
    }
    if (argument === "--database") {
      database = parseLocalDatabase(requireCliValue(args, index, "--database"));
      index += 1;
      continue;
    }
    if (argument === "--dump-path") {
      dumpPath = requireCliValue(args, index, "--dump-path");
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument ?? "<missing>"}`);
  }

  const localDatabase = database ?? `scout_${stage}_snapshot`;
  return {
    kind: "options",
    options: {
      stage,
      target: STAGES[stage],
      localDatabase,
      databaseUrl: localDatabaseUrl(localDatabase, environment),
      dumpPath: dumpPath ?? defaultDumpPath(stage, environment),
    },
  };
}

/**
 * Refuse a dump the local client cannot read.
 *
 * A newer server dumped by its own `pg_dump` produces an archive version an
 * older `pg_restore` rejects outright, so this is worth stating before spending
 * a dump on it.
 */
export function assertRestorableVersions(
  serverMajor: number,
  localRestoreMajor: number,
): void {
  if (localRestoreMajor < serverMajor) {
    throw new Error(
      `Local pg_restore is PostgreSQL ${String(localRestoreMajor)} but the source server is ${String(serverMajor)}. ` +
        "Upgrade the local PostgreSQL client (mise install) before retrying; an older client cannot read a newer archive.",
    );
  }
}

/** Major version from a client banner such as "pg_restore (PostgreSQL) 16.15". */
export function parseClientMajorVersion(output: string): number {
  const matched = CLIENT_VERSION_PATTERN.exec(output.trim());
  const major = matched?.[1];
  if (major === undefined) {
    throw new Error(
      `Could not read a PostgreSQL client version from ${JSON.stringify(output.trim())}`,
    );
  }
  return Number.parseInt(major, 10);
}

export type ExtensionSelection = {
  readonly include: string[];
  readonly skipped: string[];
};

/**
 * Which of the source's extensions to carry over.
 *
 * Only extensions the local build actually has are included. The hosted
 * clusters run monitoring extensions (`pg_stat_kcache`, `set_user`) that the
 * local build does not ship, and dumping them makes the restore fail.
 */
export function selectDumpableExtensions(
  sourceExtensions: readonly string[],
  locallyAvailable: readonly string[],
): ExtensionSelection {
  const available = new Set(locallyAvailable);
  const include = new Set<string>([EXTENSION_ANCHOR]);
  const skipped: string[] = [];
  for (const name of [...sourceExtensions].sort()) {
    if (name === EXTENSION_ANCHOR) {
      continue;
    }
    if (available.has(name)) {
      include.add(name);
    } else {
      skipped.push(name);
    }
  }
  return { include: [...include].sort(), skipped };
}

/**
 * Tables whose rows are nothing but credentials.
 *
 * Their schema is restored and their data is not. `ApiToken.token` and
 * `InstallAttributionToken.token` are both `NOT NULL` and unique, so there is
 * no redacted value to substitute — and neither table shows up in a screen
 * worth looking at locally.
 */
export const EXCLUDED_TABLE_DATA: readonly string[] = [
  "ApiToken",
  "InstallAttributionToken",
];

/**
 * How each credential column is rewritten while its row is kept.
 *
 * `replacement` is substituted for the column when the source rows are read, so
 * the real value never leaves the cluster. `verify` is asserted against every
 * restored row afterwards. Both are trusted constants, never operator input.
 *
 * Most of these are nullable, so NULL is a legal substitution.
 * `TournamentLobby.code` is not: it is `String @unique`, so it gets a
 * per-row stand-in that keeps the NOT NULL and uniqueness guarantees.
 */
export type ColumnRedaction = {
  readonly column: string;
  readonly replacement: string;
  readonly verify: string;
};

function blanked(column: string): ColumnRedaction {
  return {
    column,
    replacement: "NULL",
    verify: `"${column}" IS NULL`,
  };
}

/**
 * Credential-bearing columns whose rows are worth keeping.
 *
 * `User` holds live Discord OAuth bearer tokens,
 * `ExploreConversation.shareToken` is the only credential a share link carries,
 * and a `TournamentLobby` carries both the Riot join code and the lobby
 * password. `TournamentRegistration` and `ScoutEffectClaim.key` are documented
 * in the schema as deliberately *not* credentials and are left alone.
 */
export const REDACTED_COLUMNS: Readonly<
  Record<string, readonly ColumnRedaction[]>
> = {
  ExploreConversation: [blanked("shareToken")],
  TournamentLobby: [
    {
      column: "code",
      replacement: `'redacted-' || "id"`,
      verify: `"code" LIKE 'redacted-%'`,
    },
    blanked("password"),
  ],
  User: [
    blanked("discordAccessToken"),
    blanked("discordRefreshToken"),
    blanked("tokenExpiresAt"),
  ],
};

const IDENTIFIER_PATTERN = /^[a-z_]\w*$/iu;

function quoteIdentifier(name: string): string {
  if (!IDENTIFIER_PATTERN.test(name)) {
    throw new Error(`Refusing to interpolate unexpected identifier: ${name}`);
  }
  return `"${name}"`;
}

/** Every table whose data the dump leaves behind, excluded or redacted. */
export function tablesWithoutDumpedData(): string[] {
  return [...EXCLUDED_TABLE_DATA, ...Object.keys(REDACTED_COLUMNS)].sort();
}

/**
 * Read the source rows with credential columns blanked.
 *
 * Emitted from the pod so the tokens are never written to this machine at all,
 * rather than restored and cleaned up afterwards.
 */
export function redactedCopyOutStatement(
  table: string,
  columns: readonly string[],
  redactions: readonly ColumnRedaction[],
): string {
  if (columns.length === 0) {
    throw new Error(`No columns known for ${table}`);
  }
  const projection = columns.map((column) => {
    const redaction = redactions.find((entry) => entry.column === column);
    const quoted = quoteIdentifier(column);
    return redaction === undefined
      ? quoted
      : `${redaction.replacement} AS ${quoted}`;
  });
  return `COPY (SELECT ${projection.join(", ")} FROM ${quoteIdentifier(table)}) TO STDOUT`;
}

/** Load those rows into the restored table. */
export function copyInStatement(
  table: string,
  columns: readonly string[],
): string {
  if (columns.length === 0) {
    throw new Error(`No columns known for ${table}`);
  }
  return `COPY ${quoteIdentifier(table)} (${columns.map((column) => quoteIdentifier(column)).join(", ")}) FROM STDIN`;
}

/** Prove the redaction landed instead of assuming it did. */
export function assertRedacted(
  table: string,
  nonNullCounts: Readonly<Record<string, number>>,
): void {
  const leaked = Object.entries(nonNullCounts)
    .filter(([, count]) => count > 0)
    .map(([column, count]) => `${column} (${String(count)} rows)`);
  if (leaked.length > 0) {
    throw new Error(
      `Redaction failed: ${table} still holds unredacted values in ${leaked.sort().join(", ")}`,
    );
  }
}

/** Count rows where a redacted column did not end up as intended. */
export function redactionCheckStatement(
  table: string,
  redactions: readonly ColumnRedaction[],
): string {
  const counts = redactions.map(
    (redaction) =>
      `count(*) FILTER (WHERE NOT coalesce(${redaction.verify}, false)) AS ${quoteIdentifier(redaction.column)}`,
  );
  return `SELECT ${counts.join(", ")} FROM ${quoteIdentifier(table)}`;
}

/**
 * `pg_dump` argv, run inside the pod over its local trust socket.
 *
 * `--schema public` leaves behind the operator's own `metric_helpers` and
 * `user_management` schemas, whose functions lean on the extensions the local
 * build lacks.
 */
export function dumpArgv(input: {
  readonly binaryPath: string;
  readonly database: string;
  readonly extensions: readonly string[];
}): string[] {
  return [
    input.binaryPath,
    "--username",
    "postgres",
    "--dbname",
    input.database,
    "--format",
    "custom",
    "--no-owner",
    "--no-privileges",
    "--schema",
    "public",
    ...input.extensions.map((name) => `--extension=${name}`),
    ...tablesWithoutDumpedData().map(
      (table) => `--exclude-table-data=public."${table}"`,
    ),
  ];
}

/**
 * Restored one section at a time so the redacted rows can land in the middle.
 *
 * Foreign keys live in `post-data` and are validated as they are created, so a
 * dump carrying no `User` rows fails the moment another table's key is checked.
 * Loading the redacted rows between `data` and `post-data` keeps referential
 * integrity intact without ever writing a token to this machine.
 */
export const RESTORE_SECTIONS: readonly string[] = [
  "pre-data",
  "data",
  "post-data",
];

/**
 * `pg_restore` argv for one section.
 *
 * `--single-transaction` makes each section all-or-nothing. The caller drops
 * the target's `public` schema first so the dump's own `CREATE SCHEMA` does not
 * collide with the one `createdb` provides and abort the transaction.
 */
export function restoreArgv(input: {
  readonly databaseUrl: string;
  readonly dumpPath: string;
  readonly section: string;
}): string[] {
  return [
    "pg_restore",
    "--dbname",
    input.databaseUrl,
    "--no-owner",
    "--no-privileges",
    "--single-transaction",
    "--section",
    input.section,
    input.dumpPath,
  ];
}

/** Non-empty trimmed lines from a `psql --no-align --tuples-only` result. */
export function parseRowList(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Check the restore rather than predict it.
 *
 * Anything the dump filters out shows up here as a missing table, which is a
 * stronger guarantee than reasoning about which extensions own which objects.
 */
export function assertRestoredTables(
  sourceTables: readonly string[],
  restoredTables: readonly string[],
): void {
  const restored = new Set(restoredTables);
  const missing = sourceTables.filter((name) => !restored.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Restored database is missing ${String(missing.length)} table(s) present in the source: ${missing.sort().join(", ")}`,
    );
  }
}

/** What to run once the restore lands. dev:web owns the migration step. */
export function handoffMessage(options: DevDbPullOptions): string {
  return [
    `Restored ${options.stage} into ${options.localDatabase}.`,
    "",
    "Start the app against it with:",
    `  bun run dev:web -- --database-url ${options.databaseUrl}`,
    "",
    "dev:web applies any migrations newer than the snapshot on boot.",
  ].join("\n");
}
