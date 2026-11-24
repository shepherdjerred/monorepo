import { tmpdir } from "node:os";
import path from "node:path";
import {
  discoverPostgresBinDir,
  POSTGRES_MAJOR,
  postgresBinaryPath,
  runCommandSync,
} from "./binaries.ts";
import {
  acquireLock,
  canonicalPathIfExists,
  DISPOSABLE_TEST_PG_DIR_NAME,
  ensureDirectorySync,
  initializeAndStartCluster,
  lockIsStale,
  pgCtlServerRunning,
  type PostgresClusterDurability,
  readPostmasterPid,
  releaseLock,
  runsAsRoot,
  serverIsUp,
} from "./postmaster.ts";

export const DEFAULT_SHARED_PG_PORT = 5471;
export const SHARED_PG_ROLES = [
  "scout",
  "delivery",
  "media",
  "tracker",
  "postgres",
] as const;

export type EnsurePostgresClusterOptions = {
  readonly port: number;
  readonly explicitPortProvided: boolean;
  readonly dataRoot: string;
  readonly durability: PostgresClusterDurability;
  readonly allowWalPanicWipe: boolean;
  readonly allowedDataDirs?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly portEnvName?: string;
  readonly isolationEnvName?: string;
};

const LOCK_STALE_MS = 120_000;
const START_WAIT_MS = 120_000;

export function parsePortEnv(name: string, raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be a port number, got: ${raw}`);
  }
  return parsed;
}

function trimmedEnv(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined {
  const value = env[key]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

export function explicitPostgresPort(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): number | undefined {
  const localPort = env["LOCAL_TEST_PG_PORT"];
  if (localPort !== undefined && localPort !== "") {
    return parsePortEnv("LOCAL_TEST_PG_PORT", localPort);
  }
  const scoutPort = env["SCOUT_PG_PORT"];
  return scoutPort === undefined || scoutPort === ""
    ? undefined
    : parsePortEnv("SCOUT_PG_PORT", scoutPort);
}

function defaultNonRootDataRoots(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  major: string,
): string[] {
  const home = trimmedEnv(env, "HOME") ?? trimmedEnv(env, "USERPROFILE");
  const winAppData =
    platform === "win32" ? trimmedEnv(env, "LOCALAPPDATA") : undefined;

  const candidates: string[] = [];
  if (winAppData !== undefined) {
    candidates.push(path.join(winAppData, DISPOSABLE_TEST_PG_DIR_NAME, major));
  }
  if (home !== undefined) {
    candidates.push(
      path.join(home, ".cache", DISPOSABLE_TEST_PG_DIR_NAME, major),
    );
  }
  if (candidates.length === 0) {
    throw new Error(
      "Neither TEST_POSTGRES_DATA_ROOT, XDG_CACHE_HOME, nor HOME is set",
    );
  }
  return [...new Set(candidates)];
}

export function managedPostgresDataRoots(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
  options?: {
    readonly isRoot?: boolean;
    readonly platform?: NodeJS.Platform;
  },
): string[] {
  const major = POSTGRES_MAJOR.toString();
  const explicitDataRoot = trimmedEnv(env, "TEST_POSTGRES_DATA_ROOT");
  if (explicitDataRoot !== undefined) {
    return [path.resolve(explicitDataRoot)];
  }
  if (options?.isRoot ?? runsAsRoot()) {
    return [path.join(tmpdir(), DISPOSABLE_TEST_PG_DIR_NAME, major)];
  }
  const explicitCache = trimmedEnv(env, "XDG_CACHE_HOME");
  return explicitCache === undefined
    ? defaultNonRootDataRoots(env, options?.platform ?? process.platform, major)
    : [path.join(explicitCache, DISPOSABLE_TEST_PG_DIR_NAME, major)];
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

export function sharedPostgresPort(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): number {
  const explicit = explicitPostgresPort(env);
  if (explicit !== undefined) {
    return explicit;
  }
  let dataRoot: string;
  try {
    dataRoot = sharedPostgresDataRoot(env);
  } catch {
    return DEFAULT_SHARED_PG_PORT;
  }
  const dataDir = path.join(dataRoot, "pgdata");
  const pidInfo = readPostmasterPid(dataDir);
  if (pidInfo === undefined) {
    return DEFAULT_SHARED_PG_PORT;
  }
  try {
    if (serverIsUp(pidInfo.port)) {
      verifyRunningServer(pidInfo.port, dataDir, env);
      return pidInfo.port;
    }
  } catch {
    // Stale postmaster.pid or an unrelated listener on pidPort; fall back to default.
  }
  return DEFAULT_SHARED_PG_PORT;
}

export function sharedDatabaseUrl(
  dbName: string,
  options?: {
    readonly user?: string;
    readonly port?: number;
    readonly env?: Readonly<Record<string, string | undefined>>;
  },
): string {
  const port = options?.port ?? sharedPostgresPort(options?.env);
  const user = options?.user ?? "scout";
  return `postgres://${user}@127.0.0.1:${port.toString()}/${dbName}`;
}

export function databaseUrlFromAdmin(adminUrl: string, dbName: string): string {
  const parsed = new URL(adminUrl);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
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

const verifiedClusterUsers = new Map<string, string>();

function probeSuperuser(
  port: number,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const explicitUser = trimmedEnv(env, "LOCAL_TEST_PG_USER");
  const candidates =
    explicitUser === undefined ? ["scout", "postgres"] : [explicitUser];

  let lastError = "";
  for (const user of candidates) {
    const probe = runCommandSync(localPsqlArgs(port, user, "SELECT 1"));
    if (probe.exitCode === 0) {
      return user;
    }
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

function verifyRunningServer(
  port: number,
  expectedDataDir: string,
  env: Readonly<Record<string, string | undefined>> = Bun.env,
  explicitAllowedDataDirs?: readonly string[],
): string {
  const bootstrapUser = probeSuperuser(port, env);
  const query = String.raw`SELECT current_setting('server_version_num') || E'\n' || current_setting('data_directory') || E'\n' || (SELECT system_identifier::text FROM pg_control_system())`;
  const result = runCommandSync(localPsqlArgs(port, bootstrapUser, query));
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to query PostgreSQL server identity: ${result.stderr}`,
    );
  }
  const lines = result.stdout.trim().split(/\r?\n/u);
  const version = Number(lines[0]);
  const liveDirectory = lines[1];
  const systemId = lines[2] ?? "";
  if (liveDirectory === undefined || !Number.isInteger(version)) {
    throw new Error("Dev PostgreSQL returned an invalid server identity");
  }

  const allowedDirs = (
    explicitAllowedDataDirs ??
    managedPostgresDataRoots(env).map((root) => path.join(root, "pgdata"))
  ).map((dir) => canonicalPathIfExists(dir));

  assertDevPostgresIdentity(
    version,
    canonicalPathIfExists(liveDirectory),
    canonicalPathIfExists(expectedDataDir),
    allowedDirs,
  );

  const cacheKey = `${port.toString()}:${systemId}`;
  if (!verifiedClusterUsers.has(cacheKey)) {
    ensureSharedRoles(port, bootstrapUser);
    verifiedClusterUsers.set(cacheKey, "scout");
  }
  return verifiedClusterUsers.get(cacheKey) ?? bootstrapUser;
}

function resolvePostmasterState(input: {
  readonly port: number;
  readonly explicitPortProvided: boolean;
  readonly dataDir: string;
  readonly allowedDataDirs?: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly portEnvName: string;
  readonly isolationEnvName: string;
}): { readonly port: number; readonly superUrl: string } | undefined {
  const {
    port,
    explicitPortProvided,
    dataDir,
    allowedDataDirs,
    env,
    portEnvName,
    isolationEnvName,
  } = input;
  const pidInfo = readPostmasterPid(dataDir);
  if (pidInfo === undefined) {
    return undefined;
  }

  if (!explicitPortProvided) {
    if (!serverIsUp(pidInfo.port)) {
      return undefined;
    }
    try {
      const user = verifyRunningServer(
        pidInfo.port,
        dataDir,
        env,
        allowedDataDirs,
      );
      return {
        port: pidInfo.port,
        superUrl: sharedDatabaseUrl("postgres", { user, port: pidInfo.port }),
      };
    } catch {
      return undefined;
    }
  }

  if (pidInfo.port === port) {
    return undefined;
  }

  let activeOnPidPort = pgCtlServerRunning(dataDir);
  if (!activeOnPidPort && serverIsUp(pidInfo.port)) {
    try {
      verifyRunningServer(pidInfo.port, dataDir, env, allowedDataDirs);
      activeOnPidPort = true;
    } catch {
      activeOnPidPort = false;
    }
  }
  if (activeOnPidPort) {
    throw new Error(
      `PostgreSQL data directory ${dataDir} is already running on port ${pidInfo.port.toString()} (PID ${pidInfo.pid.toString()}), but port ${port.toString()} was requested; set ${portEnvName}=${pidInfo.port.toString()} or isolate ${isolationEnvName}`,
    );
  }
  return undefined;
}

export function ensurePostgresCluster(options: EnsurePostgresClusterOptions): {
  readonly port: number;
  readonly superUrl: string;
} {
  const env = options.env ?? Bun.env;
  discoverPostgresBinDir(env === Bun.env ? {} : { env });
  const {
    port,
    explicitPortProvided,
    dataRoot,
    durability,
    allowWalPanicWipe,
  } = options;
  const dataDir = path.join(dataRoot, "pgdata");
  const postmasterCheckInput = {
    port,
    explicitPortProvided,
    dataDir,
    ...(options.allowedDataDirs === undefined
      ? {}
      : { allowedDataDirs: options.allowedDataDirs }),
    env,
    portEnvName: options.portEnvName ?? "LOCAL_TEST_PG_PORT",
    isolationEnvName: options.isolationEnvName ?? "XDG_CACHE_HOME",
  };

  const preCheck = (): { port: number; superUrl: string } | undefined => {
    const fromPid = resolvePostmasterState(postmasterCheckInput);
    if (fromPid !== undefined) {
      return fromPid;
    }
    if (serverIsUp(port)) {
      const user = verifyRunningServer(
        port,
        dataDir,
        env,
        options.allowedDataDirs,
      );
      return { port, superUrl: sharedDatabaseUrl("postgres", { user, port }) };
    }
    return undefined;
  };

  const existing = preCheck();
  if (existing !== undefined) {
    return existing;
  }

  ensureDirectorySync(dataRoot);
  const lockDir = path.join(dataRoot, ".ensure.lock");
  const deadline = Date.now() + START_WAIT_MS;

  for (;;) {
    const ready = preCheck();
    if (ready !== undefined) {
      return ready;
    }
    if (acquireLock(lockDir)) {
      break;
    }
    if (lockIsStale(lockDir, LOCK_STALE_MS)) {
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
    const reused = resolvePostmasterState(postmasterCheckInput);
    if (reused !== undefined) {
      return reused;
    }
    if (!serverIsUp(port)) {
      initializeAndStartCluster({
        port,
        dataRoot,
        dataDir,
        durability,
        allowWalPanicWipe,
      });
    }
    const user = verifyRunningServer(
      port,
      dataDir,
      env,
      options.allowedDataDirs,
    );
    return { port, superUrl: sharedDatabaseUrl("postgres", { user, port }) };
  } finally {
    releaseLock(lockDir);
  }
}

export function ensureSharedPostgres(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): {
  readonly port: number;
  readonly superUrl: string;
} {
  const explicitPort = explicitPostgresPort(env);
  const dataRoot = sharedPostgresDataRoot(env);
  const allowedDataDirs = managedPostgresDataRoots(env).map((root) =>
    path.join(root, "pgdata"),
  );
  return ensurePostgresCluster({
    port: explicitPort ?? DEFAULT_SHARED_PG_PORT,
    explicitPortProvided: explicitPort !== undefined,
    dataRoot,
    durability: "disposable",
    allowWalPanicWipe: true,
    allowedDataDirs,
    env,
    portEnvName: "LOCAL_TEST_PG_PORT",
    isolationEnvName: "XDG_CACHE_HOME",
  });
}
