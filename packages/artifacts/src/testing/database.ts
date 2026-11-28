import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { createMigratedTestDatabase } from "@shepherdjerred/test-postgres";
import { PrismaClient } from "#generated/prisma/client.ts";

const packageRoot = path.resolve(import.meta.dir, "../..");

/** A freshly migrated PostgreSQL database, dropped by `close`. */
export async function createMigratedDatabase() {
  const handle = await createMigratedTestDatabase({
    prefix: "tracker",
    packageRoot,
    packageName: "artifacts",
  });
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
