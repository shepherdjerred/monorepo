import { Counter, Gauge } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

export const reportLakeCompactionRowsTotal = new Counter({
  name: "report_lake_compaction_rows_total",
  help: "Total lake rows written by compaction, by table and tier (fold/rebuild).",
  labelNames: ["table", "tier"] as const,
  registers: [registry],
});

/**
 * Rows skipped because a stored rawJson blob failed Zod validation. This is
 * the early-warning signal that the Raw* schemas drifted from stored data —
 * alert when it grows.
 */
export const reportLakeCompactionSkippedTotal = new Counter({
  name: "report_lake_compaction_skipped_total",
  help: "Stored rows skipped during lake compaction due to rawJson parse failures.",
  labelNames: ["table"] as const,
  registers: [registry],
});

export const reportLakeStagingWritesTotal = new Counter({
  name: "report_lake_staging_writes_total",
  help: "Ingest-time staging file writes by table and status.",
  labelNames: ["table", "status"] as const,
  registers: [registry],
});

export const reportLakeLastPublishTimestamp = new Gauge({
  name: "report_lake_last_publish_timestamp_seconds",
  help: "Unix time of the most recently published lake build, by tier.",
  labelNames: ["tier"] as const,
  registers: [registry],
});
