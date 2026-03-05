import { Hono } from "hono";

import { prisma } from "../db/client.ts";

export const healthRoutes = new Hono();

healthRoutes.get("/livez", (c) => {
  return c.json({ status: "ok" });
});

healthRoutes.get("/healthz", async (c) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return c.json({ status: "ok", db: "connected" });
  } catch {
    return c.json({ status: "error", db: "disconnected" }, 503);
  }
});
