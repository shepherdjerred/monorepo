import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "#generated/prisma-historical-intent/client.ts";
import type { Database } from "#infrastructure/database.ts";

/** Explicit pre038 fixture contract. No schema mutation, error fallback or SQL
 * replacement: old schemas have no household-monitoring state or authority. */
export async function historicalIntentFixtureDatabase(
  base: Database,
  connectionString: string,
): Promise<Database> {
  const columns = await base.$queryRaw<{ name: string }[]>`
    SELECT column_name AS name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='MediaIntent'
      AND column_name='libraryMonitoring'`;
  if (columns.length > 0)
    throw new Error("Historical intent client requires a pre038 schema");
  await base.$disconnect();
  const source = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  const client = source.$extends({
    result: {
      mediaIntent: {
        libraryMonitoring: { needs: {}, compute: () => false },
      },
    },
  });
  // The generated historical client supplies every original field. Its explicit
  // virtual false is process-local and never enters a stored historical row.
  return new Proxy(base, {
    get(_target, property): unknown {
      const receiver = property === "$on" ? source : client;
      const value: unknown = Reflect.get(receiver, property, receiver);
      return typeof value === "function" ? value.bind(receiver) : value;
    },
  });
}
