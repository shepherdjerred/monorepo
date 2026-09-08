import { Counter } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

/**
 * Database counters, kept out of the large `metrics/index.ts` barrel.
 *
 * `database/index.ts` records against this counter, and the barrel pulls in
 * `betting-sweep.ts`, which needs the Prisma client type from
 * `database/index.ts` — importing the counter from the barrel closed that
 * loop. Same reasoning as `metrics/registry.ts`.
 */
/**
 * Total number of database queries
 */
export const databaseQueriesTotal = new Counter({
  name: "database_queries_total",
  help: "Total database queries",
  labelNames: ["operation"] as const,
  registers: [registry],
});
