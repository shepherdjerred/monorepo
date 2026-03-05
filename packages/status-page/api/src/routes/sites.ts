import { Hono } from "hono";
import { z } from "zod";

import { prisma } from "../db/client.ts";

const CreateSite = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url().nullable().default(null),
});

const UpdateSite = z.object({
  name: z.string().min(1).optional(),
  url: z.string().url().nullable().optional(),
});

export const siteRoutes = new Hono();

siteRoutes.get("/api/sites", async (c) => {
  const sites = await prisma.site.findMany({
    orderBy: { createdAt: "asc" },
  });
  return c.json(sites);
});

siteRoutes.post("/api/sites", async (c) => {
  const parsed = CreateSite.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const site = await prisma.site.create({ data: parsed.data });
  return c.json(site, 201);
});

siteRoutes.put("/api/sites/:siteId", async (c) => {
  const parsed = UpdateSite.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data["name"] = parsed.data.name;
  if (parsed.data.url !== undefined) data["url"] = parsed.data.url;

  try {
    const site = await prisma.site.update({
      where: { id: c.req.param("siteId") },
      data,
    });
    return c.json(site);
  } catch {
    return c.json({ error: "Site not found" }, 404);
  }
});

siteRoutes.delete("/api/sites/:siteId", async (c) => {
  try {
    await prisma.site.delete({ where: { id: c.req.param("siteId") } });
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "Site not found" }, 404);
  }
});
