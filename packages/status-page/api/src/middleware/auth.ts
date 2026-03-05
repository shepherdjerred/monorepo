import type { Context, Next } from "hono";

import { config } from "../config.ts";

const SKIP_PATHS = new Set(["/livez", "/healthz"]);

const PUBLIC_PATTERNS = [
  /^\/api\/sites\/[^/]+\/status$/,
  /^\/api\/sites\/[^/]+\/uptime$/,
  /^\/api\/sites\/[^/]+\/components$/,
  /^\/api\/sites\/[^/]+\/incidents$/,
  /^\/api\/sites$/,
];

function isPublicPath(path: string): boolean {
  if (SKIP_PATHS.has(path)) return true;
  return PUBLIC_PATTERNS.some((pattern) => pattern.test(path));
}

export async function authMiddleware(
  c: Context,
  next: Next,
): Promise<Response | undefined> {
  if (c.req.method === "GET" && isPublicPath(c.req.path)) {
    await next();
    return undefined;
  }

  if (SKIP_PATHS.has(c.req.path)) {
    await next();
    return undefined;
  }

  if (config.authToken === "") {
    await next();
    return undefined;
  }

  const authHeader = c.req.header("Authorization");
  if (authHeader === undefined) {
    return c.json({ error: "Missing Authorization header" }, 401);
  }

  const token = authHeader.replace("Bearer ", "");
  if (token !== config.authToken) {
    return c.json({ error: "Invalid token" }, 401);
  }

  await next();
  return undefined;
}
