#!/usr/bin/env bun
import { deployDatabaseMigrations } from "#src/db/migrate.ts";
import { runLegacyImportIfNeeded } from "#src/db/import-legacy.ts";
import { disconnectPrisma } from "#src/db/index.ts";

await deployDatabaseMigrations();

// Import before Discord logs in, so the bot can never serve an empty
// leaderboard or write new karma into a database that is about to be
// backfilled. Idempotent: a populated target short-circuits the import.
try {
  await runLegacyImportIfNeeded();
} catch (error) {
  // Disconnect explicitly so a failed import exits rather than hanging on an
  // open pool; the probes recycle the pod and the next boot retries.
  await disconnectPrisma();
  throw error;
}

await import("../src/index.ts");
