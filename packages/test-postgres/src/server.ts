import { tmpdir } from "node:os";
import path from "node:path";
import {
  binariesHint,
  discoverPostgresBinDir,
  POSTGRES_MAJOR,
  postgresBinaryPath,
  runCommandSync,
  type RunResult,
} from "./binaries.ts";
import { readFileTextSync } from "./read-sync.ts";

export const DEFAULT_SHARED_PG_PORT = 5471;
export const SHARED_PG_ROLES = [
  "scout",
  "delivery",
  "media",
  "tracker",
  "postgres",
] as const;

const LOCK_STALE_MS = 120_000;
const START_WAIT_MS = 120_000;

function parsePortEnv(name: string, raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be a port number, got: ${raw}`);
  }
  return parsed;
}

export function sharedPostgresPort(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): number {
  const localPort = env["LOCAL_TEST_PG_PORT"];
  if (localPort !== undefined && localPort !== "") {
    return parsePortEnv("LOCAL_TEST_PG_PORT", localPort);
  }
  const scoutPort = env["SCOUT_PG_PORT"];
  return scoutPort !== undefined && scoutPort !== ""
    ? parsePortEnv("SCOUT_PG_PORT", scoutPort)
    : DEFAULT_SHARED_PG_PORT;
}

export function sharedDatabaseUrl(
  dbName: string,
  options?: { readonly user?: string; readonly port?: number },
): string {
  const port = options?.port ?? sharedPostgresPort();
  const user = options?.user ?? "scout";
  return `postgres://${user}@127.0.0.1:${port.toString()}/${dbName}`;
}

export function databaseUrlFromAdmin(adminUrl: string, dbName: string): string {
  const parsed = new URL(adminUrl);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

function runsAsRoot(): boolean {
  return process.getuid?.() === 0;
}

function nonEmptyEnv(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined {
  const value = env[key];
  return value !== undefined && value !== "" ? value : undefined;
}

function resolveUserBaseDirs(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
): { readonly cacheBase?: string; readonly dataBase?: string } {
  const home = nonEmptyEnv(env, "HOME") ?? nonEmptyEnv(env, "USERPROFILE");
  const winAppData =
    platform === "win32" ? nonEmptyEnv(env, "LOCALAPPDATA") : undefined;
  const cacheBase =
    nonEmptyEnv(env, "XDG_CACHE_HOME") ??
    winAppData ??
    (home === undefined ? undefined : path.join(home, ".cache"));
  const dataBase =
    nonEmptyEnv(env, "XDG_DATA_HOME") ??
    winAppData ??
    (home === undefined ? undefined : path.join(home, ".local", "share"));
  return {
    ...(cacheBase === undefined ? {} : { cacheBase }),
    ...(dataBase === undefined ? {} : { dataBase }),
  };
}

export function managedPostgresDataRoots(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
  options?: {
    readonly isRoot?: boolean;
    readonly platform?: NodeJS.Platform;
  },
): string[] {
  const major = POSTGRES_MAJOR.toString();
  if (options?.isRoot ?? runsAsRoot()) {
    const temp = tmpdir();
    return [
      path.join(temp, "monorepo-dev-pg", major),
      path.join(temp, "scout-for-lol", "postgres", major),
    ];
  }
  const { cacheBase, dataBase } = resolveUserBaseDirs(env, options?.platform);
  const home = nonEmptyEnv(env, "HOME") ?? nonEmptyEnv(env, "USERPROFILE");
  if (cacheBase === undefined && dataBase === undefined) {
    throw new Error("Neither XDG_DATA_HOME, XDG_CACHE_HOME, nor HOME is set");
  }
  const candidates: string[] = [];
  if (cacheBase !== undefined) {
    candidates.push(path.join(cacheBase, "monorepo-dev-pg", major));
  }
  if (dataBase !== undefined) {
    candidates.push(path.join(dataBase, "scout-for-lol", "postgres", major));
  }
  if (cacheBase !== undefined) {
    candidates.push(path.join(cacheBase, "scout-dev-pg", major));
  }
  if (home !== undefined) {
    candidates.push(
      path.join(home, ".cache", "monorepo-dev-pg", major),
      path.join(home, ".local", "share", "scout-for-lol", "postgres", major),
      path.join(home, ".cache", "scout-dev-pg", major),
    );
  }
  return [...new Set(candidates)];
}

export function sharedPostgresDataRoot(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): string {
  const roots = managedPostgresDataRoots(env);
  for (const root of roots) {
    if (Bun.file(path.join(root, "pgdata", "PG_VERSION")).size > 0) {
      return root;
    }
  }
  const primary = roots[0];
  if (primary === undefined) {
    throw new Error("No managed PostgreSQL data root could be resolved");
  }
  return primary;
}

function canonicalPathIfExists(targetPath: string): string {
  if (process.platform === "win32") {
    return path.resolve(targetPath);
  }
  const resolved = runCommandSync(["realpath", targetPath]);
  return resolved.exitCode === 0
    ? resolved.stdout.trim()
    : path.resolve(targetPath);
}

/** Refuse another major or an unrelated server without stopping either. */
export function assertDevPostgresIdentity(
  versionNumber: number,
  dataDirectory: string,
  expectedDataDirectory: string,
  additionalAllowedDirectories: readonly string[] = [],
): void {
  if (Math.floor(versionNumber / 10_000) !== POSTGRES_MAJOR) {
    throw new Error(
      `Dev PostgreSQL requires major ${POSTGRES_MAJOR.toString()}, but the port serves version ${versionNumber.toString()}. Stop or migrate that server explicitly, or choose an unused LOCAL_TEST_PG_PORT / SCOUT_PG_PORT.`,
    );
  }
  const allowed = new Set([
    expectedDataDirectory,
    ...additionalAllowedDirectories,
  ]);
  if (!allowed.has(dataDirectory)) {
    throw new Error(
      `Dev PostgreSQL port belongs to ${dataDirectory}, expected ${expectedDataDirectory}. Choose an unused LOCAL_TEST_PG_PORT / SCOUT_PG_PORT; the existing server was not changed.`,
    );
  }
}

function asPostgresOwner(cmd: readonly string[]): string[] {
  if (!runsAsRoot()) {
    return [...cmd];
  }
  const su = Bun.which("su");
  if (su === null) {
    throw new Error("Root-hosted Postgres tests require su");
  }
  const quoted = cmd
    .map((value) => `'${value.replaceAll("'", String.raw`'\''`)}'`)
    .join(" ");
  return [su, "-s", "/bin/sh", "nobody", "-c", quoted];
}

function runAsPostgresOwner(cmd: readonly string[]): RunResult {
  return runCommandSync(asPostgresOwner(cmd));
}

function serverIsUp(port: number): boolean {
  const args = [
    postgresBinaryPath("pg_isready"),
    "-h",
    "127.0.0.1",
    "-p",
    port.toString(),
    "-q",
  ];
  return runCommandSync(args).exitCode === 0;
}

function localPsqlArgs(port: number, user: string, sql: string): string[] {
  return [
    postgresBinaryPath("psql"),
    "--no-psqlrc",
    "-h",
    "127.0.0.1",
    "-p",
    port.toString(),
    "-U",
    user,
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-At",
    "-c",
    sql,
  ];
}

const verifiedPortUsers = new Map<number, string>();

function probeSuperuser(port: number): string {
  const cached = verifiedPortUsers.get(port);
  if (cached !== undefined) return cached;

  const explicitUser = nonEmptyEnv(Bun.env, "LOCAL_TEST_PG_USER")?.trim();
  const candidates =
    explicitUser !== undefined && explicitUser !== ""
      ? [explicitUser]
      : ["scout", "postgres"];

  let lastError = "";
  for (const user of candidates) {
    const probe = runCommandSync(localPsqlArgs(port, user, "SELECT 1"));
    if (probe.exitCode === 0) return user;
    lastError = probe.stderr.trim();
  }
  throw new Error(
    `Cannot connect to local PostgreSQL on 127.0.0.1:${port.toString()} as ${candidates.join(" or ")}: ${lastError}`,
  );
}

function ensureSharedRoles(port: number, bootstrapUser: string): void {
  const roleList = SHARED_PG_ROLES.map((role) => `'${role}'`).join(", ");
  const sql =
    `DO $$ DECLARE r text; BEGIN ` +
    `PERFORM pg_advisory_xact_lock(5471001); ` +
    `FOREACH r IN ARRAY ARRAY[${roleList}] LOOP ` +
    `IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN ` +
    `EXECUTE format('CREATE ROLE %I SUPERUSER LOGIN', r); ` +
    `END IF; END LOOP; END $$;`;
  const result = runCommandSync(localPsqlArgs(port, bootstrapUser, sql));
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to initialize shared PostgreSQL test roles: ${result.stderr}`,
    );
  }
}

function verifyRunningServer(port: number, expectedDataDir: string): string {
  const bootstrapUser = probeSuperuser(port);
  const query = String.raw`SELECT current_setting('server_version_num') || E'\n' || current_setting('data_directory')`;
  const result = runCommandSync(localPsqlArgs(port, bootstrapUser, query));
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to query PostgreSQL server identity: ${result.stderr}`,
    );
  }
  const lines = result.stdout.trim().split(/\r?\n/u);
  const version = Number(lines[0]);
  const liveDirectory = lines[1];
  if (liveDirectory === undefined || !Number.isInteger(version)) {
    throw new Error("Dev PostgreSQL returned an invalid server identity");
  }

  const allowedDirs = managedPostgresDataRoots().map((root) =>
    canonicalPathIfExists(path.join(root, "pgdata")),
  );
  assertDevPostgresIdentity(
    version,
    canonicalPathIfExists(liveDirectory),
    canonicalPathIfExists(expectedDataDir),
    allowedDirs,
  );

  if (!verifiedPortUsers.has(port)) {
    ensureSharedRoles(port, bootstrapUser);
    verifiedPortUsers.set(port, "scout");
  }
  return verifiedPortUsers.get(port) ?? bootstrapUser;
}

function ensureDirectorySync(dir: string): void {
  const cmd =
    process.platform === "win32"
      ? ["cmd.exe", "/c", "if", "not", "exist", dir, "mkdir", dir]
      : ["mkdir", "-p", dir];
  runCommandSync(cmd);
}

function acquireLock(lockDir: string): boolean {
  const cmd =
    process.platform === "win32"
      ? ["cmd.exe", "/c", "mkdir", lockDir]
      : ["mkdir", lockDir];
  if (runCommandSync(cmd).exitCode !== 0) {
    return false;
  }
  const pidPath = path.join(lockDir, "pid");
  const writeCmd =
    process.platform === "win32"
      ? ["cmd.exe", "/c", `echo ${process.pid.toString()}> "${pidPath}"`]
      : [
          "sh",
          "-c",
          String.raw`printf '%s\n' "${process.pid.toString()}" > "${pidPath}"`,
        ];
  runCommandSync(writeCmd);
  return true;
}

function releaseLock(lockDir: string): void {
  const cmd =
    process.platform === "win32"
      ? ["cmd.exe", "/c", "rmdir", "/s", "/q", lockDir]
      : ["rm", "-rf", lockDir];
  runCommandSync(cmd);
}

function lockIsStale(lockDir: string): boolean {
  const pidMtime = Bun.file(path.join(lockDir, "pid")).lastModified;
  const mtime = pidMtime > 0 ? pidMtime : Bun.file(lockDir).lastModified;
  return mtime > 0 && Date.now() - mtime > LOCK_STALE_MS;
}

function initializeAndStartCluster(
  port: number,
  dataRoot: string,
  dataDir: string,
): void {
  if (runsAsRoot()) {
    const ownership = runCommandSync(["chown", "-R", "nobody", dataRoot]);
    if (ownership.exitCode !== 0) {
      throw binariesHint(
        `chown failed for the Postgres data root: ${ownership.stderr}`,
      );
    }
  }

  const versionFile = path.join(dataDir, "PG_VERSION");
  if (Bun.file(versionFile).size > 0) {
    const stored = readFileTextSync(versionFile).trim();
    if (stored !== POSTGRES_MAJOR.toString()) {
      throw new Error(
        `Refusing to start an unreadable or different PostgreSQL major (${stored}) from ${dataDir}`,
      );
    }
  } else {
    const init = runAsPostgresOwner([
      postgresBinaryPath("initdb"),
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
  }

  const logPath = path.join(dataRoot, "server.log");
  const start = runAsPostgresOwner([
    postgresBinaryPath("pg_ctl"),
    "-D",
    dataDir,
    "-w",
    "-t",
    "30",
    "-l",
    logPath,
    "-o",
    `-p ${port.toString()} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=200`,
    "start",
  ]);
  if (start.exitCode !== 0 && !serverIsUp(port)) {
    throw binariesHint(
      `pg_ctl start failed: ${start.stderr} (log: ${logPath})`,
    );
  }
}

export function ensureSharedPostgres(): {
  readonly port: number;
  readonly superUrl: string;
} {
  discoverPostgresBinDir();
  const port = sharedPostgresPort();
  const dataRoot = sharedPostgresDataRoot();
  const dataDir = path.join(dataRoot, "pgdata");

  if (serverIsUp(port)) {
    const user = verifyRunningServer(port, dataDir);
    return { port, superUrl: sharedDatabaseUrl("postgres", { user, port }) };
  }

  ensureDirectorySync(dataRoot);
  const lockDir = path.join(dataRoot, ".ensure.lock");
  const deadline = Date.now() + START_WAIT_MS;

  for (;;) {
    if (serverIsUp(port)) {
      const user = verifyRunningServer(port, dataDir);
      return { port, superUrl: sharedDatabaseUrl("postgres", { user, port }) };
    }
    if (acquireLock(lockDir)) break;
    if (lockIsStale(lockDir)) {
      releaseLock(lockDir);
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for another process to start the shared dev Postgres on port ${port.toString()}`,
      );
    }
    Bun.sleepSync(250);
  }

  try {
    if (!serverIsUp(port)) {
      initializeAndStartCluster(port, dataRoot, dataDir);
    }
    const user = verifyRunningServer(port, dataDir);
    return { port, superUrl: sharedDatabaseUrl("postgres", { user, port }) };
  } finally {
    releaseLock(lockDir);
  }
}
