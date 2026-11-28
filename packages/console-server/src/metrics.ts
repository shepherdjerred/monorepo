import { collectDefaultMetrics, Histogram, Registry } from "prom-client";

/** `go-link` → `go_link`: the prefix every metric of a console carries. */
export function metricPrefix(name: string): string {
  return name.replaceAll(/\W/gu, "_");
}

/**
 * A registry labelled `service=<name>` with the process metrics prefixed
 * `<name>_`, which is how Go link registered them before the kit.
 */
export function createConsoleRegistry(name: string): Registry {
  const registry = new Registry();
  registry.setDefaultLabels({ service: name });
  collectDefaultMetrics({
    register: registry,
    prefix: `${metricPrefix(name)}_`,
  });
  return registry;
}

export type HttpMetrics = {
  readonly duration: Histogram<"method" | "route" | "status">;
};

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const registered = new WeakMap<Registry, HttpMetrics>();

/**
 * `<prefix>_http_request_duration_seconds{method,route,status}`. `route` is the
 * Hono route pattern (`/api/links/:short`), `static` or `spa` for files, and
 * `unmatched` for a 404 no route claimed, so cardinality stays bounded. The
 * histogram's `_count` is the per-route request count the serve-both rule
 * gates on.
 */
export function httpMetrics(registry: Registry, name: string): HttpMetrics {
  const existing = registered.get(registry);
  if (existing !== undefined) return existing;
  const metrics: HttpMetrics = {
    duration: new Histogram({
      name: `${metricPrefix(name)}_http_request_duration_seconds`,
      help: "HTTP request duration by method, route pattern and status",
      labelNames: ["method", "route", "status"] as const,
      buckets: BUCKETS,
      registers: [registry],
    }),
  };
  registered.set(registry, metrics);
  return metrics;
}
