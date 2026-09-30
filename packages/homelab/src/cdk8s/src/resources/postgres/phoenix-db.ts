import type { Chart } from "cdk8s";
import { createSingleAppPostgreSQL } from "./single-app-postgresql.ts";

// Phoenix stores tail-sampled LLM traces: span rows with large JSON
// prompt/response attributes, ~50MB/day pruned by the 30-day retention
// policy. It runs its own Alembic migrations on boot and blocks inserts well
// before the volume fills (PHOENIX_DATABASE_ALLOCATED_STORAGE_CAPACITY_GIBIBYTES).
export function createPhoenixPostgreSQLDatabase(chart: Chart) {
  return createSingleAppPostgreSQL(chart, { app: "phoenix", userFlags: [] });
}
