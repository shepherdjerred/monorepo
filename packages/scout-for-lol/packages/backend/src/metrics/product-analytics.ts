import { Counter } from "prom-client";
import { registry } from "#src/metrics/registry.ts";

export const productAnalyticsEventsTotal = new Counter({
  name: "scout_product_analytics_events_total",
  help: "Scout product analytics events accepted by the local PostHog queue",
  labelNames: ["event"] as const,
  registers: [registry],
});

export const productAnalyticsFailuresTotal = new Counter({
  name: "scout_product_analytics_failures_total",
  help: "Scout product analytics failures by bounded operation",
  labelNames: ["operation"] as const,
  registers: [registry],
});
