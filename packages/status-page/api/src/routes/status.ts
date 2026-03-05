import { Hono } from "hono";

import { prisma } from "../db/client.ts";

export const statusRoutes = new Hono();

statusRoutes.get("/api/sites/:siteId/status", async (c) => {
  const siteId = c.req.param("siteId");

  const components = await prisma.component.findMany({
    where: { siteId },
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      order: true,
      updatedAt: true,
    },
  });

  const incidents = await prisma.incident.findMany({
    where: {
      siteId,
      resolvedAt: null,
    },
    orderBy: { createdAt: "desc" },
    include: {
      updates: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return c.json({ components, incidents });
});
