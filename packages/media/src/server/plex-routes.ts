import type { Hono } from "hono";
import type { MediaActor } from "#application/auth.ts";
import type { PrismaPlexAdministration } from "#infrastructure/plex-admin.ts";
import { SavePlexProfileSchema } from "#shared/plex-admin.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import { parseInput, readJson } from "./validation.ts";

export type PlexAdministration = Pick<
  PrismaPlexAdministration,
  "profiles" | "saveProfile" | "refreshProfileAccess"
>;
export function registerPlexRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  plex: PlexAdministration,
): void {
  app.get("/api/v1/admin/plex/profiles", async (c) =>
    c.json(await plex.profiles(c.get("actor"))),
  );
  app.put("/api/v1/admin/plex/profiles", async (c) =>
    c.json(
      await plex.saveProfile(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(SavePlexProfileSchema, await readJson(c.req.raw)),
      ),
    ),
  );
}
