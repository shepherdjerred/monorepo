/**
 * Generates a template SQLite database for testing.
 * This template is copied for each test instead of running `prisma db push` every time,
 * which is much faster and avoids Bun segfault issues.
 */

import { createLogger } from "#src/logger.ts";
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const logger = createLogger("generate-test-template-db");

const templatePath = `${import.meta.dirname}/../src/testing/template.db`;
const migrationsPath = `${import.meta.dirname}/../prisma/migrations`;

if (existsSync(templatePath)) {
  unlinkSync(templatePath);
}

logger.info("Generating test template database...");

const templateDb = new Database(templatePath);
try {
  const migrationDirs = readdirSync(migrationsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const migrationDir of migrationDirs) {
    const migrationPath = join(migrationsPath, migrationDir, "migration.sql");
    if (!existsSync(migrationPath)) {
      throw new Error(`Missing migration SQL at ${migrationPath}`);
    }

    logger.info(`Applying migration ${migrationDir}...`);
    templateDb.exec(readFileSync(migrationPath, "utf8"));
  }
} finally {
  templateDb.close();
}

// Seed Season rows so tests that create season-based competitions don't trip
// the FK constraint.
const { PrismaClient } = await import("#generated/prisma/client/index.js");
const { PrismaLibSql } = await import("@prisma/adapter-libsql");
const { SEASONS } = await import("@scout-for-lol/data");
const seedPrisma = new PrismaClient({
  // Must match src/database/index.ts so seeded Season rows have INTEGER ms
  // datetimes; otherwise they would compare incorrectly against the prod
  // adapter's unixepoch-ms bindings.
  adapter: new PrismaLibSql(
    { url: `file:${templatePath}` },
    { timestampFormat: "unixepoch-ms" },
  ),
});
for (const season of Object.values(SEASONS)) {
  await seedPrisma.season.upsert({
    where: { id: season.id },
    update: {
      displayName: season.displayName,
      startDate: season.startDate,
      endDate: season.endDate,
    },
    create: {
      id: season.id,
      displayName: season.displayName,
      startDate: season.startDate,
      endDate: season.endDate,
    },
  });
}
await seedPrisma.$disconnect();

logger.info(`Template database generated at: ${templatePath}`);
