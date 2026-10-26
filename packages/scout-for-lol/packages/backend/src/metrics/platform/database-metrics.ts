import { registry } from "#src/metrics/registry.ts";
import { Counter } from "prom-client";

/**
 * Total number of database queries
 */
export const databaseQueriesTotal = new Counter({
  name: "database_queries_total",
  help: "Total database queries",
  labelNames: ["operation"] as const,
  registers: [registry],
});
