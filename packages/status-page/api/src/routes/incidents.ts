import { Hono } from "hono";
import { z } from "zod";

import { prisma } from "../db/client.ts";

const IncidentStatus = z.enum([
  "investigating",
  "identified",
  "monitoring",
  "resolved",
]);

const CreateIncident = z.object({
  title: z.string().min(1),
  status: IncidentStatus.default("investigating"),
  message: z.string().min(1),
});

const UpdateIncident = z.object({
  title: z.string().min(1).optional(),
  status: IncidentStatus.optional(),
  resolvedAt: z.string().datetime().nullable().optional(),
});

const CreateUpdate = z.object({
  status: IncidentStatus,
  message: z.string().min(1),
});

export const incidentRoutes = new Hono();

incidentRoutes.get("/api/sites/:siteId/incidents", async (c) => {
  const siteId = c.req.param("siteId");
  const incidents = await prisma.incident.findMany({
    where: { siteId },
    orderBy: { createdAt: "desc" },
    include: {
      updates: { orderBy: { createdAt: "desc" } },
    },
  });
  return c.json(incidents);
});

incidentRoutes.get("/api/sites/:siteId/incidents/:id", async (c) => {
  const siteId = c.req.param("siteId");
  const incident = await prisma.incident.findFirst({
    where: { id: c.req.param("id"), siteId },
    include: {
      updates: { orderBy: { createdAt: "desc" } },
    },
  });
  if (incident === null) {
    return c.json({ error: "Incident not found" }, 404);
  }
  return c.json(incident);
});

incidentRoutes.post("/api/sites/:siteId/incidents", async (c) => {
  const siteId = c.req.param("siteId");
  const parsed = CreateIncident.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const incident = await prisma.incident.create({
    data: {
      title: parsed.data.title,
      status: parsed.data.status,
      siteId,
      updates: {
        create: {
          status: parsed.data.status,
          message: parsed.data.message,
        },
      },
    },
    include: { updates: true },
  });
  return c.json(incident, 201);
});

incidentRoutes.put("/api/sites/:siteId/incidents/:id", async (c) => {
  const siteId = c.req.param("siteId");
  const parsed = UpdateIncident.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const existing = await prisma.incident.findFirst({
    where: { id: c.req.param("id"), siteId },
  });
  if (existing === null) {
    return c.json({ error: "Incident not found" }, 404);
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) {
    data["title"] = parsed.data.title;
  }
  if (parsed.data.status !== undefined) {
    data["status"] = parsed.data.status;
    if (parsed.data.status === "resolved") {
      data["resolvedAt"] = new Date();
    }
  }
  if (parsed.data.resolvedAt !== undefined) {
    data["resolvedAt"] =
      parsed.data.resolvedAt === null ? null : new Date(parsed.data.resolvedAt);
  }

  try {
    const incident = await prisma.incident.update({
      where: { id: c.req.param("id") },
      data,
      include: { updates: true },
    });
    return c.json(incident);
  } catch {
    return c.json({ error: "Incident not found" }, 404);
  }
});

incidentRoutes.delete("/api/sites/:siteId/incidents/:id", async (c) => {
  const siteId = c.req.param("siteId");
  const existing = await prisma.incident.findFirst({
    where: { id: c.req.param("id"), siteId },
  });
  if (existing === null) {
    return c.json({ error: "Incident not found" }, 404);
  }

  try {
    await prisma.incident.delete({ where: { id: c.req.param("id") } });
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "Incident not found" }, 404);
  }
});

incidentRoutes.post(
  "/api/sites/:siteId/incidents/:id/updates",
  async (c) => {
    const siteId = c.req.param("siteId");
    const parsed = CreateUpdate.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const incident = await prisma.incident.findFirst({
      where: { id: c.req.param("id"), siteId },
    });
    if (incident === null) {
      return c.json({ error: "Incident not found" }, 404);
    }

    const updateData: Record<string, unknown> = {
      status: parsed.data.status,
    };
    if (parsed.data.status === "resolved") {
      updateData["resolvedAt"] = new Date();
    }

    const [update] = await prisma.$transaction([
      prisma.incidentUpdate.create({
        data: {
          incidentId: c.req.param("id"),
          status: parsed.data.status,
          message: parsed.data.message,
        },
      }),
      prisma.incident.update({
        where: { id: c.req.param("id") },
        data: updateData,
      }),
    ]);

    return c.json(update, 201);
  },
);
