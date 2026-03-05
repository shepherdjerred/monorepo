import type { Context, Next } from "hono";
import { routePath } from "hono/route";

import { httpRequestDurationSeconds, httpRequestsTotal } from "../metrics.ts";

const SKIP_PATHS = new Set(["/metrics", "/api/health"]);

export async function metricsMiddleware(c: Context, next: Next): Promise<void> {
  if (SKIP_PATHS.has(c.req.path)) {
    await next();
    return;
  }

  const start = performance.now();
  await next();
  const durationSeconds = (performance.now() - start) / 1000;

  const route = routePath(c);
  const method = c.req.method;
  const status = String(c.res.status);

  httpRequestsTotal.inc({ method, route, status });
  httpRequestDurationSeconds.observe({ method, route }, durationSeconds);
}
