import type { Hono } from "hono";
import type { MediaActor } from "#application/auth.ts";
import type { PrismaRemovalHistoryApplication } from "#infrastructure/library/views/removals.ts";
import { RemovalHistoryQuerySchema } from "#shared/household/calendar.ts";
import { parseInput } from "#server/validation.ts";

export function registerRemovalHistoryRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  service: Pick<PrismaRemovalHistoryApplication, "list">,
) {
  app.get("/api/v1/removal-history", async (c) =>
    c.json(
      await service.list(
        c.get("actor"),
        parseInput(RemovalHistoryQuerySchema, c.req.query()),
      ),
    ),
  );
}
