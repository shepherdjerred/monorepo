/**
 * Lifecycle of the hash-scoped test template database.
 *
 * createTestDatabase clones it with `createdb -T`, which is the Postgres
 * replacement for the old copy-a-SQLite-file strategy. The template is
 * rebuilt (migrate deploy + SEASONS seed) whenever its content hash — the
 * baseline migration SQL, the seeded SEASONS data, and this module — no
 * longer matches the hash recorded inside the template itself.
 *
 * Runs from the bun test preload; guarded by a cross-process lock in the
 * shared data root so parallel suites refresh exactly once. The database name
 * includes the content hash so parallel checkouts never rebuild one another's
 * template while sharing the machine-wide server.
 */
import { SEASONS } from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import {
  devDatabaseUrl,
  devPostgresDataRoot,
  devPostgresPort,
  ensureDevPostgres,
  psqlMaintenance,
} from "#src/testing/postgres-server.ts";

const logger = createLogger("test-template");

/** Bump to force a rebuild when refresh logic changes shape. */
const TEMPLATE_SCHEMA_VERSION = "1";
const SWEEP_MAX_AGE_MS = 30 * 60 * 1000;
const TEMPLATE_LOCK_STALE_MS = 10 * 60 * 1000;
const TEMPLATE_LOCK_OWNER = "owner.json";
let activeTemplateDatabase: string | undefined;

const BACKEND_ROOT = `${import.meta.dir}/../..`;
const MIGRATIONS_DIR = `${BACKEND_ROOT}/prisma/migrations`;

async function computeTemplateHash(): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(TEMPLATE_SCHEMA_VERSION);
  const glob = new Bun.Glob("*/migration.sql");
  const files = [...glob.scanSync({ cwd: MIGRATIONS_DIR })].sort();
  if (files.length === 0) {
    throw new Error(`No migrations found under ${MIGRATIONS_DIR}`);
  }
  for (const file of files) {
    hasher.update(file);
    hasher.update(await Bun.file(`${MIGRATIONS_DIR}/${file}`).text());
  }
  hasher.update(JSON.stringify(SEASONS));
  return hasher.digest("hex");
}

function templateDatabaseName(hash: string): string {
  return `scout_template_${hash.slice(0, 48)}`;
}

export function getTestTemplateDatabase(): string {
  if (activeTemplateDatabase === undefined) {
    throw new Error(
      "Test template has not been initialized; run the backend test preload first",
    );
  }
  return activeTemplateDatabase;
}

function currentTemplateHash(databaseName: string): string | undefined {
  try {
    const port = devPostgresPort();
    const result = Bun.spawnSync(
      [
        "psql",
        "-h",
        "127.0.0.1",
        "-p",
        port.toString(),
        "-U",
        "scout",
        "-d",
        databaseName,
        "-At",
        "-c",
        "SELECT hash FROM _template_meta LIMIT 1",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (result.exitCode !== 0) {
      return undefined;
    }
    const hash = result.stdout.toString().trim();
    return hash === "" ? undefined : hash;
  } catch {
    return undefined;
  }
}

async function acquireTemplateLock(lockDir: string): Promise<boolean> {
  if (Bun.spawnSync(["mkdir", lockDir]).exitCode !== 0) {
    return false;
  }
  await Bun.write(
    `${lockDir}/${TEMPLATE_LOCK_OWNER}`,
    JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }),
  );
  return true;
}

async function lockIsStale(lockDir: string): Promise<boolean> {
  const ownerFile = Bun.file(`${lockDir}/${TEMPLATE_LOCK_OWNER}`);
  if (!(await ownerFile.exists())) {
    return Date.now() - Bun.file(lockDir).lastModified > TEMPLATE_LOCK_STALE_MS;
  }
  try {
    const owner: unknown = JSON.parse(await ownerFile.text());
    if (owner === null || typeof owner !== "object") {
      return Date.now() - ownerFile.lastModified > TEMPLATE_LOCK_STALE_MS;
    }
    const acquiredAt = Reflect.get(owner, "acquiredAt");
    const pid = Reflect.get(owner, "pid");
    if (
      typeof acquiredAt !== "number" ||
      typeof pid !== "number" ||
      !Number.isFinite(acquiredAt) ||
      !Number.isInteger(pid)
    ) {
      return Date.now() - ownerFile.lastModified > TEMPLATE_LOCK_STALE_MS;
    }
    if (Date.now() - acquiredAt <= TEMPLATE_LOCK_STALE_MS) {
      return false;
    }
    return Bun.spawnSync(["kill", "-0", pid.toString()]).exitCode !== 0;
  } catch {
    return Date.now() - ownerFile.lastModified > TEMPLATE_LOCK_STALE_MS;
  }
}

async function reclaimStaleTemplateLock(lockDir: string): Promise<void> {
  if (await lockIsStale(lockDir)) {
    Bun.spawnSync(["rm", "-rf", lockDir]);
  }
}

async function rebuildTemplate(
  databaseName: string,
  hash: string,
): Promise<void> {
  logger.info(`Rebuilding ${databaseName} (hash ${hash.slice(0, 12)}…)`);
  psqlMaintenance(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  psqlMaintenance(`CREATE DATABASE ${databaseName}`);

  const templateUrl = devDatabaseUrl(databaseName);
  const deploy = Bun.spawnSync(["bun", "x", "prisma", "migrate", "deploy"], {
    cwd: BACKEND_ROOT,
    env: { ...Bun.env, DATABASE_URL: templateUrl },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (deploy.exitCode !== 0) {
    throw new Error(
      `prisma migrate deploy against ${databaseName} failed: ${deploy.stderr.toString()}${deploy.stdout.toString()}`,
    );
  }

  // Seed Season rows so tests creating season-based competitions don't trip
  // the FK constraint — same data the old SQLite template carried.
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
      `INSERT INTO _template_meta (hash) VALUES ('${hash}')`,
    );
  } finally {
    // createdb -T refuses while connections to the template remain.
    await seedPrisma.$disconnect();
  }
}

/**
 * Ensure the hash-scoped template database exists and matches the current
 * schema/seed.
 */
export async function ensureTestTemplate(): Promise<void> {
  ensureDevPostgres();
  const wanted = await computeTemplateHash();
  const databaseName = templateDatabaseName(wanted);
  activeTemplateDatabase = databaseName;
  if (currentTemplateHash(databaseName) === wanted) {
    return;
  }

  const lockDir = `${devPostgresDataRoot()}/.template.lock`;
  const deadline = Date.now() + 180_000;
  for (;;) {
    await reclaimStaleTemplateLock(lockDir);
    if (await acquireTemplateLock(lockDir)) {
      break;
    }
    // Another suite is refreshing; wait for it and re-check.
    if (currentTemplateHash(databaseName) === wanted) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for template lock at ${lockDir}`);
    }
    Bun.sleepSync(250);
  }
  try {
    if (currentTemplateHash(databaseName) === wanted) {
      return;
    }
    await rebuildTemplate(databaseName, wanted);
  } finally {
    Bun.spawnSync(["rm", "-rf", lockDir]);
  }
}

/**
 * Drop leaked `scout_test_*` databases from crashed runs. Names encode their
 * creation epoch-ms, so only databases older than the age bound are dropped —
 * never a concurrently running suite's.
 */
export function sweepStaleTestDatabases(): void {
  ensureDevPostgres();
  const rows = psqlMaintenance(
    "SELECT datname FROM pg_database WHERE datname LIKE 'scout_test_%'",
  );
  if (rows === "") {
    return;
  }
  const now = Date.now();
  for (const name of rows.split("\n")) {
    const match = /^scout_test_(\d+)_/.exec(name);
    if (match?.[1] === undefined) {
      continue;
    }
    if (now - Number.parseInt(match[1], 10) < SWEEP_MAX_AGE_MS) {
      continue;
    }
    try {
      psqlMaintenance(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } catch (error) {
      // Best effort — a racing drop or lingering connection is not fatal.
      logger.warn(`Failed to sweep stale test database ${name}`, { error });
    }
  }
}
