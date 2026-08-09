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
import { disconnectPrisma } from "#src/db/index.ts";

const sourcePath =
  Bun.argv[2] ?? Bun.env["LEGACY_DATABASE_PATH"] ?? "./data/glitter.sqlite";

try {
  await importLegacyDatabase(sourcePath);
  console.warn("[Import] Complete");
} finally {
  await disconnectPrisma();
}
