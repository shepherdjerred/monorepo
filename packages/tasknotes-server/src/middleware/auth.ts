import type { Context, Next } from "hono";

import { config } from "../config.ts";

export async function authMiddleware(c: Context, next: Next): Promise<Response | undefined> {
  if (c.req.path === "/api/health") {
    await next();
    return undefined;
  }

  if (config.authToken === "") {
    await next();
    return undefined;
  }

  const authHeader = c.req.header("Authorization");
  if (authHeader === undefined) {
    return c.json({ success: false, error: "Missing Authorization header" }, 401);
  }

  const token = authHeader.replace("Bearer ", "");
  if (token !== config.authToken) {
    return c.json({ success: false, error: "Invalid token" }, 401);
  }

  await next();
  return undefined;
}
