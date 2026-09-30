import { PrismaClient } from "#generated/prisma/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { createLogger } from "#src/logger.ts";
import { databaseQueriesTotal } from "#src/metrics/platform/database-metrics.ts";

const logger = createLogger("database");

logger.info("🗄️  Initializing Prisma database client");

const basePrisma = new PrismaClient({
  // The pg pool connects lazily on first query, so importing this module does
  // not require the database to be reachable — test-setup.ts relies on that to
  // stub DATABASE_URL before mocks intercept the singleton.
  adapter: new PrismaPg({
    connectionString:
      Bun.env["DATABASE_URL"] ??
      `postgres://scout@127.0.0.1:${Bun.env["SCOUT_PG_PORT"] ?? "5471"}/scout_dev_3000`,
  }),
});

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ operation, args, query }) {
        databaseQueriesTotal.inc({ operation });
        return query(args);
      },
    },
  },
});

export type ExtendedPrismaClient = typeof prisma;

/**
 * The transaction client that the extended Prisma client supplies to
 * `$transaction` callbacks.
 *
 * This belongs with the client rather than an application helper so repository
 * modules can accept an atomic client without depending on a feature layer.
 */
type TxCallback = Extract<
  Parameters<ExtendedPrismaClient["$transaction"]>[0],
  (arg: never) => unknown
>;
export type Db = Parameters<TxCallback>[0];

logger.info("✅ Database client initialized");
