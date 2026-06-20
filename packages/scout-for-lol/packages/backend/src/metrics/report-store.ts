import { Counter } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

export const reportStoreIngestTotal = new Counter({
  name: "report_store_ingest_total",
  help: "Total report-store payload ingestion attempts by payload type, source, and status.",
  labelNames: ["payload_type", "source", "status"] as const,
  registers: [registry],
});

export const reportStoreIngestFactsTotal = new Counter({
  name: "report_store_ingest_facts_total",
  help: "Total report-store fact rows touched by payload type and source.",
  labelNames: ["payload_type", "source"] as const,
  registers: [registry],
});
