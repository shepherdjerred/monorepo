/**
 * Generates a template SQLite database for testing.
 * This template is copied for each test instead of running `prisma db push` every time,
 * which is much faster and avoids Bun segfault issues.
 */

import { createLogger } from "#src/logger.ts";

const logger = createLogger("generate-test-template-db");

const templatePath = `${import.meta.dirname}/../src/testing/template.db`;
const schemaPath = `${import.meta.dirname}/../prisma/schema.prisma`;

// Remove existing template if it exists
const templateFile = Bun.file(templatePath);
if (await templateFile.exists()) {
  const { unlinkSync } = await import("node:fs");
  unlinkSync(templatePath);
}

logger.info("Generating test template database...");

const result = Bun.spawnSync(
  [
    "bunx",
    "prisma",
    "db",
    "push",
    `--schema=${schemaPath}`,
    "--accept-data-loss",
  ],
  {
    cwd: `${import.meta.dirname}/..`,
    env: {
      ...Bun.env,
      DATABASE_URL: `file:${templatePath}`,
      PRISMA_GENERATE_SKIP_AUTOINSTALL: "true",
      PRISMA_SKIP_POSTINSTALL_GENERATE: "true",
    },
    stdout: "inherit",
    stderr: "inherit",
  },
);

if (result.exitCode !== 0) {
  logger.error("Failed to generate test template database");
  process.exit(1);
}

// `prisma db push` creates the schema but doesn't run migration data steps,
// so the Season table is empty. Seed it so tests that create season-based
// competitions don't trip the FK constraint.
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
