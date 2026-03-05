import { Hono } from "hono";

import { config } from "../config.ts";
import { registry } from "../metrics.ts";

const startTime = Date.now();

export const healthRoutes = new Hono();

healthRoutes.get("/api/health", (c) => {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.replace("Bearer ", "");
  const authenticated = config.authToken === "" || token === config.authToken;

  return c.json({
    status: "ok",
    version: "0.1.0",
    uptime: Math.round((Date.now() - startTime) / 1000),
    authenticated,
  });
});

healthRoutes.get("/metrics", async (c) => {
  const metrics = await registry.metrics();
  return c.text(metrics, 200, {
    "Content-Type": registry.contentType,
  });
});
