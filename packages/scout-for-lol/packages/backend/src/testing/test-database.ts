import { PrismaClient } from "#generated/prisma/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  devDatabaseUrl,
  devPostgresPort,
} from "#src/testing/postgres-server.ts";
import { getTestTemplateDatabase } from "#src/testing/test-template.ts";

function extendClient(client: PrismaClient): ExtendedPrismaClient {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          return query(args);
        },
      },
    },
  });
}

export function connectTestDatabase(databaseUrl: string): ExtendedPrismaClient {
  const parsed = new URL(databaseUrl);
  if (
    parsed.protocol !== "postgres:" ||
    !/^scout_test_[a-z0-9_]+$/u.test(parsed.pathname.slice(1))
  ) {
    throw new Error(`Refusing to connect to non-test database ${databaseUrl}`);
  }
  return extendClient(
    new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    }),
  );
}

/** Postgres identifiers cap at 63 bytes; the name encodes its creation time. */
function testDatabaseName(testName: string): string {
  const sanitized = testName
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
  const prefix = `scout_test_${Date.now().toString()}_${Math.random().toString(36).slice(2, 6)}_`;
  return `${prefix}${sanitized}`.slice(0, 63);
}

/**
 * Creates an isolated test database and returns an ExtendedPrismaClient
 * configured to use it.
 *
 * Clones the pre-built hash-scoped test template database on the shared local
 * Postgres server (`createdb -T` is a server-side file copy, ~50–150ms —
 * the Postgres equivalent of the old copy-a-SQLite-file strategy). The
 * template is ensured/refreshed by the bun test preload (test-setup.ts).
 *
 * @param testName - A unique name for this test suite (encoded into the
 *   database name)
 * @returns `prisma` plus the database name (`dbPath`, kept for API
 *   compatibility — it is no longer a filesystem path) and its URL
 */
export function createTestDatabase(testName: string): {
  prisma: ExtendedPrismaClient;
  dbPath: string;
  dbUrl: string;
} {
  const dbName = testDatabaseName(testName);
  const templateDatabase = getTestTemplateDatabase();
  const port = devPostgresPort();
  const result = Bun.spawnSync(
    [
      "createdb",
      "-h",
      "127.0.0.1",
      "-p",
      port.toString(),
      "-U",
      "scout",
      "-T",
      templateDatabase,
      dbName,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `createdb -T ${templateDatabase} ${dbName} failed: ${result.stderr.toString()}\n` +
        `Run \`bun test\` from packages/backend once to build the template, ` +
        `and \`mise install\` at the repo root if Postgres binaries are missing.`,
    );
  }

  const dbUrl = devDatabaseUrl(dbName);
  return {
    // Must mirror src/database/index.ts so tests exercise the same adapter
    // as production.
    prisma: connectTestDatabase(dbUrl),
    dbPath: dbName,
    dbUrl,
  };
}

export async function dropTestDatabase(
  prismaClient: ExtendedPrismaClient,
  databaseName: string,
): Promise<void> {
  if (!/^scout_test_[a-z0-9_]+$/u.test(databaseName)) {
    throw new Error(`Refusing to drop non-test database ${databaseName}`);
  }
  await prismaClient.$disconnect();
  const result = Bun.spawnSync(
    [
      "dropdb",
      "-h",
      "127.0.0.1",
      "-p",
      devPostgresPort().toString(),
      "-U",
      "scout",
      "--force",
      databaseName,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `dropdb ${databaseName} failed: ${result.stderr.toString()}`,
    );
  }
}

/**
 * Helper function to safely delete from tables that might not exist.
 * Useful in beforeEach/afterEach hooks for cleanup.
 *
 * @param fn - A function that returns a Promise (e.g., prisma.table.deleteMany())
 */
export async function deleteIfExists(
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
  } catch {
    // Table might not exist, ignore
  }
}
