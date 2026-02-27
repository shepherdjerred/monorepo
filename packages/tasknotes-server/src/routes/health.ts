import { Hono } from "hono";

import { registry } from "../metrics.ts";

const startTime = Date.now();

export const healthRoutes = new Hono();

healthRoutes.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    version: "0.1.0",
    uptime: Math.round((Date.now() - startTime) / 1000),
  });
});

healthRoutes.get("/metrics", async (c) => {
  const metrics = await registry.metrics();
  return c.text(metrics, 200, {
    "Content-Type": registry.contentType,
  });
});
