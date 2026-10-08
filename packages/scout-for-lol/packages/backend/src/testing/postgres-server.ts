/**
 * Shared local Postgres server for dev and tests.
 *
 * One machine-wide server (data dir under XDG data, port 5471 by default)
 * hosts per-checkout `scout_dev_<port>` databases and per-test
 * `scout_test_*` databases. In CI pods $HOME is pod-local, so "machine-wide"
 * degenerates to pod-local with no special-casing and no sidecar.
 *
 * Everything here is synchronous (Bun.spawnSync) so it can run from the
 * bun test preload and from createTestDatabase without an event loop.
 * This module is dev/test-only: it must never be imported by src/index.ts
 * or anything reachable from the production image entrypoint.
 */
import { createLogger } from "#src/logger.ts";

const logger = createLogger("postgres-server");

const DEFAULT_PORT = 5471;
const POSTGRES_MAJOR = 18;
let binariesVerified = false;
/** initdb/start window guard only; normal operation takes no lock. */
const LOCK_STALE_MS = 120_000;
const START_WAIT_MS = 120_000;

export function devPostgresPort(): number {
  const raw = Bun.env["SCOUT_PG_PORT"];
  if (raw === undefined || raw === "") {
    return DEFAULT_PORT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`SCOUT_PG_PORT must be a port number, got: ${raw}`);
  }
  return parsed;
}

export function devDatabaseUrl(dbName: string): string {
  return `postgres://scout@127.0.0.1:${devPostgresPort().toString()}/${dbName}`;
}

/** Version-suffixed so a future major bump gets a fresh initdb. */
export function devPostgresDataRoot(): string {
  if (runsAsRoot()) {
    return `/tmp/scout-for-lol/postgres/${POSTGRES_MAJOR.toString()}`;
  }
  const xdg = Bun.env["XDG_DATA_HOME"];
  const home = Bun.env["HOME"];
  if (
    (xdg === undefined || xdg === "") &&
    (home === undefined || home === "")
  ) {
    throw new Error("Neither XDG_DATA_HOME nor HOME is set");
  }
  const base =
    xdg !== undefined && xdg !== "" ? xdg : `${home ?? ""}/.local/share`;
  return `${base}/scout-for-lol/postgres/${POSTGRES_MAJOR.toString()}`;
}

type RunResult = { exitCode: number; stdout: string; stderr: string };

function run(cmd: string[], env?: Record<string, string>): RunResult {
  const result = Bun.spawnSync(cmd, {
    env: { ...Bun.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function shellQuote(value: string): string {
  const escapedValue = value.replaceAll("'", String.raw`'\''`);
  return `'${escapedValue}'`;
}

function runsAsRoot(): boolean {
  return process.getuid?.() === 0;
}

function asPostgresOwner(cmd: string[]): string[] {
  if (!runsAsRoot()) {
    return cmd;
  }
  const executable = cmd[0];
  if (executable === undefined) {
    throw new Error("Postgres command cannot be empty");
  }
  const su = Bun.which("su");
  if (su === null) {
    throw new Error("Root-hosted Postgres tests require su");
  }
  // Resolve the repository's selected tool, even when old versions remain
  // installed. Running a mise shim as nobody would resolve that user's config.
  const selected = run(["mise", "which", executable]);
  const resolvedExecutable = selected.stdout.trim();
  if (resolvedExecutable === "" || selected.exitCode !== 0) {
    throw new Error(
      `Root-hosted Postgres tests require the mise-selected ${executable}: ${selected.stderr}`,
    );
  }
  return [
    su,
    "-s",
    "/bin/sh",
    "nobody",
    "-c",
    [resolvedExecutable, ...cmd.slice(1)]
      .map((value) => shellQuote(value))
      .join(" "),
  ];
}

function runAsPostgresOwner(cmd: string[]): RunResult {
  return run(asPostgresOwner(cmd));
}

function binariesHint(toolError: string): Error {
  return new Error(
    `${toolError}\nPostgres binaries not found or not working — run \`mise install\` at the repo root ` +
      `(pinned ubi:theseus-rs/postgresql-binaries in .mise.toml).`,
  );
}

function serverIsUp(port: number): boolean {
  const result = run([
    "pg_isready",
    "-h",
    "127.0.0.1",
    "-p",
    port.toString(),
    "-q",
  ]);
  return result.exitCode === 0;
}

/** Refuse another major or an unrelated server without stopping either. */
export function assertDevPostgresIdentity(
  versionNumber: number,
  dataDirectory: string,
  expectedDataDirectory: string,
): void {
  if (Math.floor(versionNumber / 10_000) !== POSTGRES_MAJOR) {
    throw new Error(
      `Dev PostgreSQL requires major ${POSTGRES_MAJOR.toString()}, but the port serves version ${versionNumber.toString()}. Stop or migrate that server explicitly, or choose an unused SCOUT_PG_PORT.`,
    );
  }
  if (dataDirectory !== expectedDataDirectory) {
    throw new Error(
      `Dev PostgreSQL port belongs to ${dataDirectory}, expected ${expectedDataDirectory}. Choose an unused SCOUT_PG_PORT; the existing server was not changed.`,
    );
  }
}

function verifyRunningServer(dataDir: string): void {
  const identity = psqlMaintenance(
    String.raw`SELECT current_setting('server_version_num') || E'\n' || current_setting('data_directory')`,
  ).split("\n");
  const version = Number(identity[0]);
  const directory = identity[1];
  if (directory === undefined || !Number.isInteger(version)) {
    throw new Error("Dev PostgreSQL returned an invalid server identity");
  }
  assertDevPostgresIdentity(
    version,
    canonicalDirectory(directory),
    Bun.file(`${dataDir}/PG_VERSION`).size > 0
      ? canonicalDirectory(dataDir)
      : dataDir,
  );
}

function canonicalDirectory(directory: string): string {
  const result = run(["realpath", directory]);
  if (result.exitCode !== 0) {
    throw new Error(
      `Cannot resolve PostgreSQL directory ${directory}: ${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function verifyBinaries(): void {
  if (binariesVerified) return;
  const version = run(["postgres", "--version"]);
  if (
    version.exitCode !== 0 ||
    !version.stdout.startsWith(
      `postgres (PostgreSQL) ${POSTGRES_MAJOR.toString()}.`,
    )
  ) {
    throw binariesHint(
      `Expected PostgreSQL ${POSTGRES_MAJOR.toString()} binaries: ${version.stdout}${version.stderr}`,
    );
  }
  binariesVerified = true;
}

/**
 * psql against the maintenance database. Throws on nonzero exit.
 */
export function psqlMaintenance(sql: string): string {
  const port = devPostgresPort();
  const result = run([
    "psql",
    "-h",
    "127.0.0.1",
    "-p",
    port.toString(),
    "-U",
    "scout",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-At",
    "-c",
    sql,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`psql failed (${sql}): ${result.stderr}`);
  }
  return result.stdout.trim();
}

/**
 * Atomic cross-process lock: mkdir (non-recursive) succeeds for exactly one
 * process. The pid file's mtime is the staleness clock.
 */
function acquireLock(lockDir: string): boolean {
  const result = run(["mkdir", lockDir]);
  if (result.exitCode !== 0) {
    return false;
  }
  Bun.spawnSync(["sh", "-c", `echo $$ > ${lockDir}/pid`]);
  return true;
}

function releaseLock(lockDir: string): void {
  run(["rm", "-rf", lockDir]);
}

function lockIsStale(lockDir: string): boolean {
  const pidFile = Bun.file(`${lockDir}/pid`);
  // lastModified is 0 for a missing file — a lock dir without a pid file yet
  // is mid-creation; treat as fresh.
  const mtime = pidFile.lastModified;
  return mtime > 0 && Date.now() - mtime > LOCK_STALE_MS;
}

/**
 * Idempotently ensure the shared dev server is initialized and running.
 * Reuse requires readiness, the selected major, and this harness's data dir.
 */
export function ensureDevPostgres(): { port: number; superUrl: string } {
  const port = devPostgresPort();
  const superUrl = devDatabaseUrl("postgres");
  const dataRoot = devPostgresDataRoot();
  const dataDir = `${dataRoot}/pgdata`;
  verifyBinaries();
  if (serverIsUp(port)) {
    verifyRunningServer(dataDir);
    return { port, superUrl };
  }

  const lockDir = `${dataRoot}/.ensure.lock`;
  run(["mkdir", "-p", dataRoot]);

  const deadline = Date.now() + START_WAIT_MS;
  for (;;) {
    if (serverIsUp(port)) {
      verifyRunningServer(dataDir);
      return { port, superUrl };
    }
    if (acquireLock(lockDir)) {
      break;
    }
    if (lockIsStale(lockDir)) {
      logger.warn(`Removing stale postgres ensure lock at ${lockDir}`);
      releaseLock(lockDir);
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for another process to start the dev Postgres on port ${port.toString()}`,
      );
    }
    Bun.sleepSync(250);
  }

  try {
    // Re-check under the lock — the previous holder may have finished.
    if (serverIsUp(port)) {
      verifyRunningServer(dataDir);
      return { port, superUrl };
    }

    if (runsAsRoot()) {
      const ownership = run(["chown", "-R", "nobody", dataRoot]);
      if (ownership.exitCode !== 0) {
        throw binariesHint(
          `chown failed for the Postgres data root: ${ownership.stderr}`,
        );
      }
    }

    // Bun.file(...).size is 0 for a missing file; PG_VERSION is never empty.
    if (Bun.file(`${dataDir}/PG_VERSION`).size === 0) {
      logger.info(`Initializing dev Postgres data dir at ${dataDir}`);
      // C locale: byte-order collation, identical between laptop and CI.
      const init = runAsPostgresOwner([
        "initdb",
        "-D",
        dataDir,
        "-U",
        "scout",
        "--auth=trust",
        "--encoding=UTF8",
        "--no-locale",
        "--data-checksums",
      ]);
      if (init.exitCode !== 0) {
        throw binariesHint(`initdb failed: ${init.stderr}`);
      }
    } else {
      const storedVersion = run(["cat", `${dataDir}/PG_VERSION`]);
      if (
        storedVersion.exitCode !== 0 ||
        storedVersion.stdout.trim() !== POSTGRES_MAJOR.toString()
      ) {
        throw new Error(
          `Refusing to start an unreadable or different PostgreSQL major from ${dataDir}: ${storedVersion.stderr}`,
        );
      }
    }

    logger.info(`Starting dev Postgres on 127.0.0.1:${port.toString()}`);
    // Trust auth is loopback-only; durability flags are deliberate — this
    // server only ever holds throwaway dev/test data.
    const start = runAsPostgresOwner([
      "pg_ctl",
      "-D",
      dataDir,
      "-w",
      "-t",
      "30",
      "-l",
      `${dataRoot}/server.log`,
      "-o",
      `-p ${port.toString()} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=200`,
      "start",
    ]);
    if (start.exitCode !== 0 && !serverIsUp(port)) {
      throw binariesHint(
        `pg_ctl start failed: ${start.stderr} (log: ${dataRoot}/server.log)`,
      );
    }
    verifyRunningServer(dataDir);
    return { port, superUrl };
  } finally {
    releaseLock(lockDir);
  }
}

/** Create a database on the shared server if it does not already exist. */
export function ensureDatabase(dbName: string): void {
  ensureDevPostgres();
  const exists = psqlMaintenance(
    `SELECT 1 FROM pg_database WHERE datname = '${dbName.replaceAll("'", "''")}'`,
  );
  if (exists === "1") {
    return;
  }
  const port = devPostgresPort();
  const result = run([
    "createdb",
    "-h",
    "127.0.0.1",
    "-p",
    port.toString(),
    "-U",
    "scout",
    dbName,
  ]);
  // A concurrent creator winning the race is success, not failure.
  if (result.exitCode !== 0 && !result.stderr.includes("already exists")) {
    throw new Error(`createdb ${dbName} failed: ${result.stderr}`);
  }
}
