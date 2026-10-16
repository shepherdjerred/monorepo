import { Counter, Gauge } from "prom-client";
import { register } from "./metrics.ts";

export const mediaSafetyRejected = new Counter({
  name: "media_download_safety_rejected_total",
  help: "Confirmed dangerous media torrents removed after application blocklisting",
  labelNames: ["application"] as const,
  registers: [register],
});
export const mediaSafetyLastSuccess = new Gauge({
  name: "media_download_safety_last_success_timestamp_seconds",
  help: "Last successful media metadata scan, including observation mode",
  registers: [register],
});
