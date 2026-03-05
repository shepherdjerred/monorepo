import type { Context, Next } from "hono";

const SKIP_PATHS = new Set(["/metrics", "/api/health"]);

export async function loggerMiddleware(c: Context, next: Next): Promise<void> {
  if (SKIP_PATHS.has(c.req.path)) {
    await next();
    return;
  }

  const start = performance.now();
  await next();
  const ms = (performance.now() - start).toFixed(0);

  console.log(`${c.req.method} ${c.req.path} ${String(c.res.status)} ${ms}ms`);
}
