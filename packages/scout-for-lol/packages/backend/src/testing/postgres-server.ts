/**
 * Shared local Postgres server adapter for Scout dev and tests.
 *
 * Delegates cluster discovery, role bootstrap, and maintenance queries to
 * `@shepherdjerred/test-postgres` while preserving Scout's public signatures.
 */
import * as testPostgres from "@shepherdjerred/test-postgres";

export function devPostgresPort(): number {
  return testPostgres.sharedPostgresPort();
}

export function devDatabaseUrl(dbName: string): string {
  return testPostgres.sharedDatabaseUrl(dbName, { user: "scout" });
}

export function devPostgresDataRoot(): string {
  return testPostgres.sharedPostgresDataRoot();
}

export const assertDevPostgresIdentity = testPostgres.assertDevPostgresIdentity;

export function psqlMaintenance(sql: string): string {
  return testPostgres.psqlMaintenance(sql);
}

export function ensureDevPostgres(): { port: number; superUrl: string } {
  return testPostgres.ensureSharedPostgres();
}

export function ensureDatabase(dbName: string): void {
  testPostgres.ensureDatabase(dbName);
}
