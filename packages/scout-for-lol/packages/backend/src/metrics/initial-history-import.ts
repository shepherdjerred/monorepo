import { Counter, Gauge } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

export const initialHistoryImportJobs = new Gauge({
  name: "scout_initial_history_import_jobs",
  help: "Initial history import jobs by bounded workflow phase.",
  labelNames: ["phase"] as const,
  registers: [registry],
});

export const initialHistoryImportOldestActionableTimestamp = new Gauge({
  name: "scout_initial_history_import_oldest_actionable_timestamp_seconds",
  help: "Request timestamp of the oldest actionable initial history import, or zero.",
  registers: [registry],
});

export const initialHistoryImportPhasesTotal = new Counter({
  name: "scout_initial_history_import_phases_total",
  help: "Initial history import phase outcomes.",
  labelNames: ["phase", "outcome"] as const,
  registers: [registry],
});

export const initialHistoryImportMatchesTotal = new Counter({
  name: "scout_initial_history_import_matches_total",
  help: "Initial history matches by bounded ingest outcome.",
  labelNames: ["outcome"] as const,
  registers: [registry],
});

export const initialHistoryImportRetriesTotal = new Counter({
  name: "scout_initial_history_import_retries_total",
  help: "Initial history import retries by bounded failure class.",
  labelNames: ["reason"] as const,
  registers: [registry],
});

export const initialHistoryImportRankTotal = new Counter({
  name: "scout_initial_history_import_rank_total",
  help: "Current rank enrichment outcomes for initial history imports.",
  labelNames: ["outcome"] as const,
  registers: [registry],
});
