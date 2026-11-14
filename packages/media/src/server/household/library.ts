import type { Hono } from "hono";
import type { MediaActor } from "#application/auth.ts";
import type { PrismaLibraryApplication } from "#infrastructure/library/views/library.ts";
import { LibraryQuerySchema } from "#shared/household/library.ts";
import { parseInput } from "#server/validation.ts";

export function registerLibraryRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  service: Pick<PrismaLibraryApplication, "list">,
) {
  app.get("/api/v1/library", async (c) =>
    c.json(
      await service.list(
        c.get("actor"),
        parseInput(LibraryQuerySchema, c.req.query()),
      ),
    ),
  );
}
