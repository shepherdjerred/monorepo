import { Hono } from "hono";

import { prisma } from "../db/client.ts";

export const uptimeRoutes = new Hono();

uptimeRoutes.get("/api/sites/:siteId/uptime", async (c) => {
  const siteId = c.req.param("siteId");
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const components = await prisma.component.findMany({
    where: { siteId },
    orderBy: { order: "asc" },
    select: { id: true, name: true },
  });

  const uptimeData = await Promise.all(
    components.map(async (component) => {
      const checks = await prisma.uptimeCheck.findMany({
        where: {
          componentId: component.id,
          checkedAt: { gte: ninetyDaysAgo },
        },
        select: { isUp: true, responseTimeMs: true, checkedAt: true },
        orderBy: { checkedAt: "desc" },
      });

      const totalChecks = checks.length;
      const upChecks = checks.filter((check) => check.isUp).length;
      const uptimePercentage =
        totalChecks > 0 ? (upChecks / totalChecks) * 100 : 100;

      const responseTimes = checks
        .map((check) => check.responseTimeMs)
        .filter((ms) => ms !== null);
      const avgResponseTime =
        responseTimes.length > 0
          ? Math.round(
              responseTimes.reduce((sum, ms) => sum + ms, 0) /
                responseTimes.length,
            )
          : null;

      return {
        componentId: component.id,
        componentName: component.name,
        uptimePercentage: Math.round(uptimePercentage * 100) / 100,
        avgResponseTimeMs: avgResponseTime,
        totalChecks,
        period: {
          from: ninetyDaysAgo.toISOString(),
          to: new Date().toISOString(),
        },
      };
    }),
  );

  return c.json(uptimeData);
});
