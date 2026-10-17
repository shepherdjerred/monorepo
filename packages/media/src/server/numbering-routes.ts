import type { Hono } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { PrismaNumberingAdministration } from "#infrastructure/numbering-admin.ts";
import { SaveEpisodeNumberingSchema } from "#shared/numbering.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import { parseInput, readJson } from "./validation.ts";
export type NumberingAdministration = Pick<
  PrismaNumberingAdministration,
  "series" | "episodes" | "save"
>;
export function registerNumberingRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  numbering: NumberingAdministration,
): void {
  app.get("/api/v1/admin/numbering/series", async (c) =>
    c.json(
      await numbering.series(
        c.get("actor"),
        parseInput(z.string().max(200), c.req.query("q") ?? ""),
      ),
    ),
  );
  app.get("/api/v1/admin/numbering/series/:id", async (c) =>
    c.json(
      await numbering.episodes(
        c.get("actor"),
        parseInput(z.uuid(), c.req.param("id")),
        parseInput(
          z.coerce.number().int().nonnegative().max(1_000_000),
          c.req.query("offset") ?? "0",
        ),
      ),
    ),
  );
  app.put("/api/v1/admin/numbering/episodes/:id", async (c) =>
    c.json(
      await numbering.save(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(z.uuid(), c.req.param("id")),
        parseInput(SaveEpisodeNumberingSchema, await readJson(c.req.raw)),
      ),
    ),
  );
}
