import { Counter } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

/** Champion-mastery snapshot outcomes; never label this with player identity. */
export const championMasterySnapshotReadsTotal = new Counter({
  name: "champion_mastery_snapshot_reads_total",
  help: "Champion-mastery snapshot reads by cache or Riot outcome",
  labelNames: ["outcome"] as const,
  registers: [registry],
});
