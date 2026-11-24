#!/usr/bin/env bun
/**
 * Ensure Scout's durable local dev PostgreSQL cluster is running and a database
 * exists. Rooted at `$XDG_DATA_HOME/scout-for-lol/postgres/18`
 * (`~/.local/share/scout-for-lol/postgres/18`) with `fsync=on` and
 * `full_page_writes=on` and no auto-wipe, separate from `@shepherdjerred/test-postgres`.
 *
 * Spawned by `scripts/dev/dev-web.ts`, `scripts/dev/dev-db-pull.ts`, and
 * `backend#dev` before `prisma migrate deploy`:
 *
 *   bun run scripts/ensure-dev-postgres.ts <database-name>
 */
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ensureDatabase,
  ensurePostgresCluster,
  parsePortEnv,
  POSTGRES_MAJOR,
  sharedDatabaseUrl,
} from "@shepherdjerred/test-postgres";

export const DEFAULT_SCOUT_DEV_PG_PORT = 5472;

function nonEmptyEnv(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined {
  const value = env[key];
  return value === undefined || value === "" ? undefined : value;
}

export function scoutDurablePostgresDataRoot(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
  options?: {
    readonly isRoot?: boolean;
    readonly platform?: NodeJS.Platform;
  },
): string {
  const major = POSTGRES_MAJOR.toString();
  if (options?.isRoot ?? process.getuid?.() === 0) {
    return path.join(tmpdir(), "scout-for-lol", "postgres", major);
  }
  const explicitDataHome = nonEmptyEnv(env, "XDG_DATA_HOME")?.trim();
  if (explicitDataHome !== undefined && explicitDataHome !== "") {
    return path.join(explicitDataHome, "scout-for-lol", "postgres", major);
  }
  const platform = options?.platform ?? process.platform;
  if (platform === "win32") {
    const winAppData = nonEmptyEnv(env, "LOCALAPPDATA")?.trim();
    if (winAppData !== undefined && winAppData !== "") {
      return path.join(winAppData, "scout-for-lol", "postgres", major);
    }
  }
  const home =
    nonEmptyEnv(env, "HOME")?.trim() ?? nonEmptyEnv(env, "USERPROFILE")?.trim();
  if (home === undefined || home === "") {
    throw new Error("Neither XDG_DATA_HOME nor HOME is set");
  }
  return path.join(home, ".local", "share", "scout-for-lol", "postgres", major);
}

export function scoutDurablePostgresPort(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): number {
  const raw = nonEmptyEnv(env, "SCOUT_PG_PORT");
  return raw === undefined
    ? DEFAULT_SCOUT_DEV_PG_PORT
    : parsePortEnv("SCOUT_PG_PORT", raw);
}

export function ensureScoutDurablePostgres(
  dbName: string,
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(dbName)) {
    throw new Error(`Invalid database name: ${dbName}`);
  }
  const port = scoutDurablePostgresPort(env);
  const dataRoot = scoutDurablePostgresDataRoot(env);
  const { port: activePort, superUrl } = ensurePostgresCluster({
    port,
    explicitPortProvided: true,
    dataRoot,
    // Durable cluster: fsync=on, synchronous_commit=on, full_page_writes=on, never auto-wiped.
    durability: "durable",
    allowWalPanicWipe: false,
    allowedDataDirs: [path.join(dataRoot, "pgdata")],
    env,
    portEnvName: "SCOUT_PG_PORT",
    isolationEnvName: "XDG_DATA_HOME",
  });
  ensureDatabase(dbName, { adminUrl: superUrl });
  return sharedDatabaseUrl(dbName, { user: "scout", port: activePort });
}

if (import.meta.main) {
  const dbName = Bun.argv[2];
  if (dbName === undefined || dbName === "") {
    throw new Error("Usage: ensure-dev-postgres.ts <database-name>");
  }
  const readyUrl = ensureScoutDurablePostgres(dbName);
  console.log(`dev postgres ready: ${readyUrl}`);
}
