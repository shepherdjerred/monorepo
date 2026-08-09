#!/usr/bin/env bun
import { exitOnFatal, initObservability } from "#src/observability.ts";
import { deployDatabaseMigrations } from "#src/db/migrate.ts";
import { runLegacyImportIfNeeded } from "#src/db/import-legacy.ts";
import { disconnectPrisma } from "#src/db/index.ts";

// Armed FIRST. Migrations and the legacy import are the riskiest part of
// startup — a locked or unwritable database, or a half-applied migration —
// and they run before `src/index.ts` is imported. Initializing Sentry there
// would have left exactly these failures visible only in container logs.
initObservability();

try {
  await deployDatabaseMigrations();

  // Import before Discord logs in, so the bot can never serve an empty
  // leaderboard or write new karma into a database that is about to be
  // backfilled. Idempotent: a populated target short-circuits the import.
  await runLegacyImportIfNeeded();
} catch (error) {
  // Disconnect so a failed bootstrap exits rather than hanging on an open
  // pool; the probes recycle the pod and the next boot retries.
  await disconnectPrisma();
  exitOnFatal("startup-bootstrap", error);
  throw error;
}

await import("../src/index.ts");
