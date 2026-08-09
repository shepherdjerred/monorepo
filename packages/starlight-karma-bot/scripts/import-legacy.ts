#!/usr/bin/env bun
/**
 * One-shot CLI wrapper around the legacy import.
 *
 * The import also runs automatically at startup (see `scripts/start.ts`), so
 * this exists for rehearsals against a copy and for re-running by hand:
 *
 *   DATABASE_PATH=./data/karma.db bun scripts/import-legacy.ts ./data/glitter.sqlite
 *
 * Unlike the startup path, this refuses a non-empty target rather than
 * skipping — running it by hand is an explicit request to import.
 */
import { importLegacyDatabase } from "#src/db/import-legacy.ts";
import { deployDatabaseMigrations } from "#src/db/migrate.ts";
import { disconnectPrisma } from "#src/db/index.ts";

const sourcePath =
  Bun.argv[2] ?? Bun.env["LEGACY_DATABASE_PATH"] ?? "./data/glitter.sqlite";

try {
  // A rehearsal usually points at a fresh DATABASE_PATH, where the karma table
  // does not exist yet; without this the import fails on a missing table
  // instead of running. `scripts/start.ts` does the same for the automatic path.
  await deployDatabaseMigrations();
  await importLegacyDatabase(sourcePath);
  console.warn("[Import] Complete");
} finally {
  await disconnectPrisma();
}
