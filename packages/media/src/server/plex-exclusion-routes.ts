import type { Hono } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { PrismaPlexExclusionAdministration } from "#infrastructure/plex-exclusion-service.ts";
import {
  PreparePlexExclusionSchema,
  ExecutePlexExclusionSchema,
} from "#shared/plex-exclusion.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import { parseInput, readJson } from "./validation.ts";

export type PlexExclusionAdministration = Pick<
  PrismaPlexExclusionAdministration,
  "list" | "prepare" | "detail" | "execute" | "recover"
>;
/** Owner-only handlers run after authentication and CSRF middleware. */
export function registerPlexExclusionRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  service: PlexExclusionAdministration,
): void {
  app.get("/api/v1/admin/plex-exclusion", async (c) =>
    c.json(await service.list(c.get("actor"))),
  );
  app.post("/api/v1/admin/plex-exclusion/:id/recover", async (c) =>
    c.json(
      await service.recover(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(z.uuid(), c.req.param("id")),
        parseInput(ExecutePlexExclusionSchema, await readJson(c.req.raw)),
      ),
      202,
    ),
  );
  app.post("/api/v1/admin/plex-exclusion/prepare", async (c) =>
    c.json(
      await service.prepare(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(PreparePlexExclusionSchema, await readJson(c.req.raw)),
      ),
      202,
    ),
  );
  app.get("/api/v1/admin/plex-exclusion/:id", async (c) =>
    c.json(
      await service.detail(
        c.get("actor"),
        parseInput(z.uuid(), c.req.param("id")),
      ),
    ),
  );
  app.post("/api/v1/admin/plex-exclusion/:id/execute", async (c) =>
    c.json(
      await service.execute(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(z.uuid(), c.req.param("id")),
        parseInput(ExecutePlexExclusionSchema, await readJson(c.req.raw)),
      ),
      202,
    ),
  );
}
