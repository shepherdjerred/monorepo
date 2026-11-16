/**
 * Lifecycle of Scout's hash-scoped test template database on the shared local
 * PostgreSQL harness (`@shepherdjerred/test-postgres`).
 */
import { SEASONS } from "@scout-for-lol/data";
import {
  computeMigrationHash,
  ensureSharedPostgres,
  ensureTemplateDatabase,
  envWithPostgresBin,
  formatTemplateDatabaseName,
  isTemplateDatabaseReadySync,
  runCommandAsync,
  sweepStaleTestDatabases as sweepSharedStaleTestDatabases,
  sweepStaleTestDatabasesOnce,
} from "@shepherdjerred/test-postgres";

const BACKEND_ROOT = `${import.meta.dir}/../..`;
const MIGRATIONS_DIR = `${BACKEND_ROOT}/prisma/migrations`;
const ENSURE_TEMPLATE_SCRIPT = `${BACKEND_ROOT}/scripts/ensure-test-template.ts`;
const SCOUT_HASH_INPUTS = [JSON.stringify(SEASONS)];

let activeTemplateDatabase: string | undefined;

function computeScoutTemplateHash(): string {
  return computeMigrationHash({
    migrationsDir: MIGRATIONS_DIR,
    extraInputs: SCOUT_HASH_INPUTS,
  });
}

async function populateScoutTemplate(
  templateUrl: string,
  wantedHash: string,
): Promise<void> {
  const deploy = await runCommandAsync(
    ["bun", "x", "prisma", "migrate", "deploy"],
    {
      cwd: BACKEND_ROOT,
      env: envWithPostgresBin({ DATABASE_URL: templateUrl }),
    },
  );
  if (deploy.exitCode !== 0) {
    throw new Error(
      `prisma migrate deploy failed: ${deploy.stderr}${deploy.stdout}`,
    );
  }

  const { PrismaClient } = await import("#generated/prisma/client/index.js");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const seedPrisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: templateUrl }),
  });
  try {
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
    await seedPrisma.$executeRawUnsafe(
      "CREATE TABLE _template_meta (hash text NOT NULL)",
    );
    await seedPrisma.$executeRawUnsafe(
      `INSERT INTO _template_meta (hash) VALUES ('${wantedHash}')`,
    );
  } finally {
    await seedPrisma.$disconnect();
  }
}

export function getTestTemplateDatabase(): string {
  if (activeTemplateDatabase === undefined) {
    throw new Error(
      "Test template has not been initialized; call ensureTestTemplate or ensureTestTemplateSync first",
    );
  }
  return activeTemplateDatabase;
}

export function ensureTestTemplateSync(): void {
  if (activeTemplateDatabase !== undefined) return;
  ensureSharedPostgres();
  sweepStaleTestDatabasesOnce();

  const wanted = computeScoutTemplateHash();
  const databaseName = formatTemplateDatabaseName("scout", wanted);
  if (!isTemplateDatabaseReadySync(databaseName, wanted)) {
    const result = Bun.spawnSync(
      ["bun", "--no-install", ENSURE_TEMPLATE_SCRIPT],
      {
        cwd: BACKEND_ROOT,
        env: envWithPostgresBin(),
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `ensure-test-template exited with status ${result.exitCode.toString()}; the ${databaseName} template could not be rebuilt`,
      );
    }
    if (!isTemplateDatabaseReadySync(databaseName, wanted)) {
      throw new Error(
        `${databaseName} does not carry hash ${wanted.slice(0, 12)}… after a rebuild`,
      );
    }
  }
  activeTemplateDatabase = databaseName;
}

export async function ensureTestTemplate(): Promise<void> {
  const wanted = computeScoutTemplateHash();
  const ensured = await ensureTemplateDatabase({
    prefix: "scout",
    user: "scout",
    hash: wanted,
    populate: (templateUrl) => populateScoutTemplate(templateUrl, wanted),
  });
  activeTemplateDatabase = ensured.templateName;
}

export function sweepStaleTestDatabases(): void {
  ensureSharedPostgres();
  sweepSharedStaleTestDatabases();
}
