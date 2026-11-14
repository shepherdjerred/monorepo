/**
 * Lifecycle of the hash-scoped test template database.
 *
 * createTestDatabase clones it with `createdb -T`, which is the Postgres
 * replacement for the old copy-a-SQLite-file strategy. The template is
 * rebuilt (migrate deploy + SEASONS seed) whenever its content hash — the
 * baseline migration SQL, the seeded SEASONS data, and this module — no
 * longer matches the hash recorded inside the template itself.
 *
 * Runs lazily from the first createTestDatabase call in a test process (not
 * from the test preload, so suites that never touch Postgres never start it);
 * guarded by a cross-process lock in the shared data root so parallel suites
 * refresh exactly once. The database name includes the content hash so
 * parallel checkouts never rebuild one another's template while sharing the
 * machine-wide server.
 *
 * The template and every clone carry an owner record
 * (src/testing/test-database-owner.ts); the sweep and the template rebuild
 * drop only databases whose recorded owner is provably gone from this host,
 * and never force a drop over live connections.
 */
import { SEASONS } from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import { z } from "zod";
import {
  currentDatabaseOwner,
  decideSweep,
  decideTemplateRebuild,
  hostProcessProbe,
  ownerCommentSql,
  parseOwnerComment,
  type OwnerRecord,
} from "#src/testing/test-database-owner.ts";
import {
  devDatabaseUrl,
  devPostgresDataRoot,
  devPostgresPort,
  ensureDevPostgres,
  psqlMaintenance,
} from "#src/testing/postgres-server.ts";

const logger = createLogger("test-template");

/**
 * Bump to force a rebuild when refresh logic changes shape. 2: templates carry
 * an owner record, so a partial build can be told apart from a live one.
 */
const TEMPLATE_SCHEMA_VERSION = "2";
const UNOWNED_LOG_LIMIT = 10;
const TEMPLATE_LOCK_STALE_MS = 10 * 60 * 1000;
const TEMPLATE_LOCK_OWNER = "owner.json";
const TemplateLockOwnerSchema = z.object({
  pid: z.number().int(),
  acquiredAt: z.number(),
});
let activeTemplateDatabase: string | undefined;

const BACKEND_ROOT = `${import.meta.dir}/../..`;
const MIGRATIONS_DIR = `${BACKEND_ROOT}/prisma/migrations`;
const ENSURE_TEMPLATE_SCRIPT = `${BACKEND_ROOT}/scripts/ensure-test-template.ts`;

/**
 * Synchronous so createTestDatabase (called at suite module scope) can use it;
 * Bun.mmap is the synchronous file read (Bun.file().text() is not).
 */
function computeTemplateHash(): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(TEMPLATE_SCHEMA_VERSION);
  const glob = new Bun.Glob("*/migration.sql");
  const files = [...glob.scanSync({ cwd: MIGRATIONS_DIR })].sort();
  if (files.length === 0) {
    throw new Error(`No migrations found under ${MIGRATIONS_DIR}`);
  }
  for (const file of files) {
    hasher.update(file);
    hasher.update(Bun.mmap(`${MIGRATIONS_DIR}/${file}`));
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
      "Test template has not been initialized; call ensureTestTemplate or ensureTestTemplateSync first",
    );
  }
  return activeTemplateDatabase;
}

/**
 * The synchronous entry createTestDatabase uses: the first clone in a process
 * ensures the server, sweeps leaked databases and checks the template hash;
 * later clones return at once. A template rebuild seeds through Prisma, which
 * is async, so a miss runs scripts/ensure-test-template.ts in a child Bun
 * process and waits for it. Suites call createTestDatabase at module scope,
 * so this path cannot await.
 */
export function ensureTestTemplateSync(): void {
  if (activeTemplateDatabase !== undefined) return;
  sweepStaleTestDatabases();
  const wanted = computeTemplateHash();
  const databaseName = templateDatabaseName(wanted);
  if (currentTemplateHash(databaseName) !== wanted) {
    const result = Bun.spawnSync(
      ["bun", "--no-install", ENSURE_TEMPLATE_SCRIPT],
      {
        cwd: BACKEND_ROOT,
        env: Bun.env,
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `ensure-test-template exited with status ${result.exitCode.toString()}; the ${databaseName} template could not be rebuilt`,
      );
    }
    if (currentTemplateHash(databaseName) !== wanted) {
      throw new Error(
        `${databaseName} does not carry hash ${wanted.slice(0, 12)}… after a rebuild`,
      );
    }
  }
  activeTemplateDatabase = databaseName;
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
    const parsed: unknown = JSON.parse(await ownerFile.text());
    const { acquiredAt, pid } = TemplateLockOwnerSchema.parse(parsed);
    return (
      Date.now() - acquiredAt > TEMPLATE_LOCK_STALE_MS &&
      Bun.spawnSync(["kill", "-0", pid.toString()]).exitCode !== 0
    );
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
  const existing = listDatabases(`datname = '${databaseName}'`)[0];
  const decision = decideTemplateRebuild({
    exists: existing !== undefined,
    record: existing?.record ?? { kind: "none" },
    wantedHash: hash,
    activeConnections: existing?.connections ?? 0,
    probe: hostProcessProbe,
  });
  if (decision.action === "refuse") {
    throw new Error(
      `Refusing to rebuild ${databaseName}: ${decision.reason}. Drop it by hand only after confirming no run uses it.`,
    );
  }
  logger.info(`Rebuilding ${databaseName} (hash ${hash.slice(0, 12)}…)`);
  if (decision.action === "drop-partial") {
    // No FORCE: a connection that appeared since the check fails the drop.
    psqlMaintenance(`DROP DATABASE "${databaseName}"`);
  }
  psqlMaintenance(`CREATE DATABASE "${databaseName}"`);
  psqlMaintenance(ownerCommentSql(databaseName, currentDatabaseOwner()));

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
  // Marks the build complete, so a later rebuild never drops this template.
  psqlMaintenance(
    ownerCommentSql(databaseName, {
      ...currentDatabaseOwner(),
      templateHash: hash,
    }),
  );
}

/**
 * Ensure the hash-scoped template database exists and matches the current
 * schema/seed.
 */
export async function ensureTestTemplate(): Promise<void> {
  ensureDevPostgres();
  const wanted = computeTemplateHash();
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

const DatabaseRowSchema = z.array(
  z.strictObject({
    name: z.string(),
    comment: z.string().nullable(),
    connections: z.number().int().nonnegative(),
  }),
);

type DatabaseRow = { name: string; record: OwnerRecord; connections: number };

/** Databases matching `where`, with their owner record and connection count. */
function listDatabases(where: string): DatabaseRow[] {
  const json = psqlMaintenance(
    `SELECT coalesce(json_agg(json_build_object(` +
      `'name', d.datname, ` +
      `'comment', shobj_description(d.oid, 'pg_database'), ` +
      `'connections', (SELECT count(*) FROM pg_stat_activity a WHERE a.datid = d.oid)` +
      `)), '[]') FROM pg_database d WHERE ${where}`,
  );
  return DatabaseRowSchema.parse(JSON.parse(json)).map((row) => ({
    name: row.name,
    record: parseOwnerComment(row.comment),
    connections: row.connections,
  }));
}

/**
 * Drop `scout_test_*` databases leaked by crashed runs on this host. Only a
 * database whose owner record names this host, whose owner process is gone
 * (dead, or its PID reused), that is past the grace period and has no
 * connections is dropped, and never with FORCE. Unowned databases — legacy,
 * other tools — are logged and kept; age alone never drops anything.
 */
export function sweepStaleTestDatabases(): void {
  ensureDevPostgres();
  const now = Date.now();
  const unowned: string[] = [];
  for (const row of listDatabases(
    String.raw`d.datname LIKE 'scout\_test\_%'`,
  )) {
    const decision = decideSweep({
      record: row.record,
      activeConnections: row.connections,
      now,
      probe: hostProcessProbe,
    });
    if (decision.action === "keep") {
      if (
        decision.reason === "unowned" ||
        decision.reason === "malformed-owner"
      ) {
        unowned.push(row.name);
      } else if (decision.reason === "active-connections") {
        logger.warn(
          `Keeping ${row.name}: its owner is gone but ${row.connections.toString()} connection(s) remain`,
        );
      }
      continue;
    }
    try {
      psqlMaintenance(`DROP DATABASE IF EXISTS "${row.name}"`);
    } catch (error) {
      // A connection that arrived since the listing makes the drop fail; the
      // database is kept and the next sweep reconsiders it.
      logger.warn(`Failed to sweep stale test database ${row.name}`, { error });
    }
  }
  if (unowned.length > 0) {
    const shown = unowned.slice(0, UNOWNED_LOG_LIMIT).join(", ");
    const more =
      unowned.length > UNOWNED_LOG_LIMIT
        ? ` and ${(unowned.length - UNOWNED_LOG_LIMIT).toString()} more`
        : "";
    logger.info(
      `Kept ${unowned.length.toString()} scout_test_* database(s) with no harness owner record: ${shown}${more}`,
    );
  }
}
