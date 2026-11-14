import type { Hono } from "hono";
import type { MediaActor } from "#application/auth.ts";
import type { PrismaCalendarApplication } from "#infrastructure/library/views/calendar.ts";
import { CalendarQuerySchema } from "#shared/household/calendar.ts";
import { parseInput } from "#server/validation.ts";

export function registerCalendarRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  service: Pick<PrismaCalendarApplication, "list">,
) {
  app.get("/api/v1/calendar", async (c) =>
    c.json(
      await service.list(
        c.get("actor"),
        parseInput(CalendarQuerySchema, c.req.query()),
      ),
    ),
  );
}
