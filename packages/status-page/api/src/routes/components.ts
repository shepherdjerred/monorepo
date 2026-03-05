import { Hono } from "hono";
import { z } from "zod";

import { prisma } from "../db/client.ts";

const CreateComponent = z.object({
  name: z.string().min(1),
  status: z
    .enum(["operational", "degraded", "partial_outage", "major_outage"])
    .default("operational"),
  order: z.number().int().default(0),
  monitorUrl: z.string().url().nullable().default(null),
});

const UpdateComponent = z.object({
  name: z.string().min(1).optional(),
  status: z
    .enum(["operational", "degraded", "partial_outage", "major_outage"])
    .optional(),
  order: z.number().int().optional(),
  monitorUrl: z.string().url().nullable().optional(),
});

export const componentRoutes = new Hono();

componentRoutes.get("/api/sites/:siteId/components", async (c) => {
  const siteId = c.req.param("siteId");
  const components = await prisma.component.findMany({
    where: { siteId },
    orderBy: { order: "asc" },
  });
  return c.json(components);
});

componentRoutes.get("/api/sites/:siteId/components/:id", async (c) => {
  const siteId = c.req.param("siteId");
  const component = await prisma.component.findFirst({
    where: { id: c.req.param("id"), siteId },
    include: { uptimeChecks: { orderBy: { checkedAt: "desc" }, take: 100 } },
  });
  if (component === null) {
    return c.json({ error: "Component not found" }, 404);
  }
  return c.json(component);
});

componentRoutes.post("/api/sites/:siteId/components", async (c) => {
  const siteId = c.req.param("siteId");
  const parsed = CreateComponent.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const component = await prisma.component.create({
    data: { ...parsed.data, siteId },
  });
  return c.json(component, 201);
});

componentRoutes.put("/api/sites/:siteId/components/:id", async (c) => {
  const siteId = c.req.param("siteId");
  const parsed = UpdateComponent.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data["name"] = parsed.data.name;
  if (parsed.data.status !== undefined) data["status"] = parsed.data.status;
  if (parsed.data.order !== undefined) data["order"] = parsed.data.order;
  if (parsed.data.monitorUrl !== undefined)
    data["monitorUrl"] = parsed.data.monitorUrl;

  try {
    const existing = await prisma.component.findFirst({
      where: { id: c.req.param("id"), siteId },
    });
    if (existing === null) {
      return c.json({ error: "Component not found" }, 404);
    }
    const component = await prisma.component.update({
      where: { id: c.req.param("id") },
      data,
    });
    return c.json(component);
  } catch {
    return c.json({ error: "Component not found" }, 404);
  }
});

componentRoutes.delete("/api/sites/:siteId/components/:id", async (c) => {
  const siteId = c.req.param("siteId");
  try {
    const existing = await prisma.component.findFirst({
      where: { id: c.req.param("id"), siteId },
    });
    if (existing === null) {
      return c.json({ error: "Component not found" }, 404);
    }
    await prisma.component.delete({ where: { id: c.req.param("id") } });
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "Component not found" }, 404);
  }
});
