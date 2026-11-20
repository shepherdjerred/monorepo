import { Counter } from "prom-client";
import { register } from "@shepherdjerred/streambot/observability/metrics-registry.ts";

export const ANALYTICS_OUTCOMES = [
  "captured",
  "dropped",
  "disabled",
  "failed",
] as const;
export type AnalyticsOutcome = (typeof ANALYTICS_OUTCOMES)[number];

/** The `delivery` event label counts asynchronous transport failures reported by the SDK. */
export const analyticsEventsTotal = new Counter({
  name: "streambot_analytics_events_total",
  help: "Usage analytics events by closed event name and capture outcome",
  labelNames: ["event", "outcome"] as const,
  registers: [register],
});
