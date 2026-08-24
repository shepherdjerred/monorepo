#!/usr/bin/env bun
/**
 * Ensure the shared local dev Postgres is running and a database exists.
 * Spawned by scripts/dev-web.ts (scout package root) before `prisma migrate
 * deploy`, mirroring how migrations themselves are spawned in this cwd.
 *
 *   bun run scripts/ensure-dev-postgres.ts <database-name>
 */
import {
  devDatabaseUrl,
  ensureDatabase,
} from "#src/testing/postgres-server.ts";

const dbName = Bun.argv[2];
if (dbName === undefined || dbName === "") {
  throw new Error("Usage: ensure-dev-postgres.ts <database-name>");
}
if (!/^[a-z][a-z0-9_]*$/.test(dbName)) {
  throw new Error(`Invalid database name: ${dbName}`);
}
ensureDatabase(dbName);
console.log(`dev postgres ready: ${devDatabaseUrl(dbName)}`);
