import type { Hono } from "hono";
import type { MediaActor } from "#application/auth.ts";
import type { CapacityAdministration } from "#infrastructure/capacity/service.ts";
import { CapacityViewSchema } from "#shared/capacity/view.ts";

export function registerCapacityRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  service: CapacityAdministration,
) {
  app.get("/api/v1/admin/capacity", async (c) =>
    c.json(CapacityViewSchema.parse(await service.capacity(c.get("actor")))),
  );
}
