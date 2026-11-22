import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTemplateTestDatabase,
  ensureTemplateDatabase,
  envWithPostgresBin,
  runCommandAsync,
} from "@shepherdjerred/test-postgres";
import { createDatabase } from "#infrastructure/database.ts";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationsDir = path.join(packageRoot, "prisma/migrations");

async function populateTrackerTemplate(
  templateUrl: string,
  allowAnyMajor: boolean,
): Promise<void> {
  const result = await runCommandAsync(["bun", "run", "migrate:deploy"], {
    cwd: packageRoot,
    env: envWithPostgresBin({ DATABASE_URL: templateUrl }, { allowAnyMajor }),
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Tracker template migrate:deploy failed: ${result.stderr || result.stdout}`,
    );
  }
}

async function noopStop(): Promise<void> {
  // Shared local PostgreSQL server stays up across test processes.
}

/** Ensures the hash-scoped Tracker template database on the shared local PostgreSQL harness. */
export async function startTestPostgres() {
  const configuredAdmin = Bun.env["TRACKER_TEST_ADMIN_URL"]?.trim();
  const adminUrl =
    configuredAdmin === undefined || configuredAdmin === ""
      ? undefined
      : configuredAdmin;
  const ensured = await ensureTemplateDatabase({
    prefix: "tracker",
    user: "tracker",
    adminUrl,
    migrationsDir,
    populate: (templateUrl) =>
      populateTrackerTemplate(templateUrl, adminUrl !== undefined),
  });
  return {
    adminUrl: ensured.adminUrl,
    templateUrl: ensured.templateUrl,
    stop: noopStop,
  };
}

export async function cloneTestDatabase(adminUrl: string) {
  const handle = await createTemplateTestDatabase({
    prefix: "tracker",
    user: "tracker",
    adminUrl,
    migrationsDir,
    populate: (templateUrl) => populateTrackerTemplate(templateUrl, true),
  });
  const database = createDatabase(handle.url);
  const close = async () => {
    await database.$disconnect();
    await handle.drop();
  };
  return {
    database,
    url: handle.url,
    close,
  };
}
