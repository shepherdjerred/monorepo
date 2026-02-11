/**
 * Generates a template SQLite database for testing.
 * This template is copied for each test instead of running `prisma db push` every time,
 * which is much faster and avoids Bun segfault issues.
 */

import { createLogger } from "@shepherdjerred/scout-backend/logger.ts";

const logger = createLogger("generate-test-template-db");

const templatePath = `${import.meta.dirname}/../src/testing/template.db`;
const schemaPath = `${import.meta.dirname}/../prisma/schema.prisma`;

// Remove existing template if it exists
const templateFile = Bun.file(templatePath);
if (await templateFile.exists()) {
  const { unlinkSync } = await import("fs");
  unlinkSync(templatePath);
}

logger.info("Generating test template database...");

const result = Bun.spawnSync(
  ["bunx", "prisma", "db", "push", `--schema=${schemaPath}`, "--skip-generate", "--accept-data-loss"],
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

logger.info(`Template database generated at: ${templatePath}`);
