import { Counter } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

export const ingestionReconciliationSkipsTotal = new Counter({
  name: "ingestion_reconciliation_skips_total",
  help: "Total number of ingestion reconciliation runs skipped due to mutex lock",
  labelNames: ["reason"] as const,
  registers: [registry],
});
