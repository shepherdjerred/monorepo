import { Counter, Gauge } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

export const scoutTemporalConnected = new Gauge({
  name: "scout_temporal_connected",
  help: "Whether the embedded Scout Temporal worker supervisor is connected",
  registers: [registry],
});

export const scoutTemporalWorkers = new Gauge({
  name: "scout_temporal_workers",
  help: "Number of running embedded Scout Temporal workers",
  labelNames: ["queue_class"] as const,
  registers: [registry],
});

export const scoutTemporalReconnects = new Counter({
  name: "scout_temporal_reconnects_total",
  help: "Temporal supervisor reconnect attempts after startup",
  registers: [registry],
});

export const scoutTemporalStartsRejected = new Counter({
  name: "scout_temporal_starts_rejected_total",
  help: "Durable starts rejected while Temporal is degraded or shutting down",
  labelNames: ["reason"] as const,
  registers: [registry],
});
