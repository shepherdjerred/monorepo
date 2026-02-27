import { Hono } from "hono";

const startTime = Date.now();

export const healthRoutes = new Hono();

healthRoutes.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    version: "0.1.0",
    uptime: Math.round((Date.now() - startTime) / 1000),
  });
});
