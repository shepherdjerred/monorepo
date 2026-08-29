import { Counter, Gauge } from "prom-client";
import { register } from "./metrics.ts";

export const reportDeliveryTotal = new Counter({
  name: "temporal_report_delivery_total",
  help: "Temporal report delivery attempts by report type, execution state, verdict, and outcome",
  labelNames: ["report_type", "execution", "verdict", "outcome"] as const,
  registers: [register],
});

export const reportLastAcceptedTimestampSeconds = new Gauge({
  name: "temporal_report_last_accepted_timestamp_seconds",
  help: "Unix timestamp of the most recently accepted report heartbeat by report type and schedule id",
  labelNames: ["report_type", "schedule_id"] as const,
  registers: [register],
});

export const reportFreshnessState = new Gauge({
  name: "temporal_report_freshness_state",
  help: "Report heartbeat freshness by schedule id: 2 pending, 1 fresh, 0 stale, -1 unknown",
  labelNames: ["temporal_namespace", "schedule_id"] as const,
  registers: [register],
});
