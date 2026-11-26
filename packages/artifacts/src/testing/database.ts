import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  createEmptyTestDatabase,
  ensureSharedPostgres,
  envWithPostgresBin,
  runCommandAsync,
} from "@shepherdjerred/test-postgres";
import { PrismaClient } from "#generated/prisma/client.ts";

const packageRoot = path.resolve(import.meta.dir, "../..");

/** A freshly migrated PostgreSQL database, dropped by `close`. */
export async function createMigratedDatabase() {
  const shared = ensureSharedPostgres();
  const handle = await createEmptyTestDatabase({
    prefix: "tracker",
    kind: "test",
    adminUrl: shared.superUrl,
  });
  const migrate = await runCommandAsync(["bun", "run", "migrate:deploy"], {
    cwd: packageRoot,
    env: envWithPostgresBin({ DATABASE_URL: handle.url }),
  });
  if (migrate.exitCode !== 0)
    throw new Error(
      `artifacts prisma migrate deploy failed: ${migrate.stderr || migrate.stdout}`,
    );
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: handle.url }),
  });
  return {
    db,
    url: handle.url,
    close: async () => {
      await db.$disconnect();
      await handle.drop();
    },
  };
}
