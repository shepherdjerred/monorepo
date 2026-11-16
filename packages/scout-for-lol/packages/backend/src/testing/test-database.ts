import { PrismaClient } from "#generated/prisma/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  cloneTemplateDatabaseSync,
  dropOwnedTestDatabase,
} from "@shepherdjerred/test-postgres";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  ensureTestTemplateSync,
  getTestTemplateDatabase,
} from "#src/testing/test-template.ts";

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
    .replaceAll(/[^a-z0-9_]+/gu, "_")
    .replaceAll(/^_+|_+$/gu, "");
  const prefix = `scout_test_${Date.now().toString()}_${Math.random().toString(36).slice(2, 6)}_`;
  return `${prefix}${sanitized}`.slice(0, 63);
}

export function createTestDatabase(testName: string): {
  prisma: ExtendedPrismaClient;
  dbPath: string;
  dbUrl: string;
} {
  const dbName = testDatabaseName(testName);
  ensureTestTemplateSync();
  const templateName = getTestTemplateDatabase();
  const handle = cloneTemplateDatabaseSync({
    prefix: "scout",
    user: "scout",
    templateName,
    dbName,
  });

  return {
    prisma: connectTestDatabase(handle.url),
    dbPath: dbName,
    dbUrl: handle.url,
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
  await dropOwnedTestDatabase(databaseName);
}

export async function deleteIfExists(
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
  } catch {
    // Table might not exist, ignore
  }
}

export async function testDatabaseModule(
  prisma: ExtendedPrismaClient,
): Promise<Record<string, unknown>> {
  const actual: Record<string, unknown> =
    await import("#src/database/index.ts");
  return { ...actual, prisma };
}
