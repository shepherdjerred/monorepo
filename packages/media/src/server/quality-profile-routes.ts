import type { Hono } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { MediaApplication } from "#application/ports.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import { SaveQualityProfileSchema } from "#shared/api.ts";
import { CancelSchema, parseInput, readJson } from "./validation.ts";

export function registerQualityProfileRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  media: Pick<
    MediaApplication,
    | "profiles"
    | "profileDefaults"
    | "setProfileDefault"
    | "saveProfile"
    | "assignProfile"
    | "retireProfile"
  >,
) {
  app.get("/api/v1/profiles", async (c) =>
    c.json(await media.profiles(c.get("actor"))),
  );
  app.get("/api/v1/profile-defaults", async (c) =>
    c.json(await media.profileDefaults(c.get("actor"))),
  );
  app.put("/api/v1/admin/profile-defaults/:kind", async (c) =>
    c.json(
      await media.setProfileDefault(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(z.enum(["movie", "series"]), c.req.param("kind")),
        parseInput(
          z
            .object({
              expectedVersion: z.number().int().nonnegative(),
              profileId: z.string().min(1),
            })
            .strict(),
          await readJson(c.req.raw),
        ),
      ),
    ),
  );
  app.post("/api/v1/admin/profiles", async (c) =>
    c.json(
      await media.saveProfile(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(SaveQualityProfileSchema, await readJson(c.req.raw)),
      ),
      202,
    ),
  );
  app.put("/api/v1/media/:id/profile", async (c) =>
    c.json(
      await media.assignProfile(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        c.req.param("id"),
        parseInput(
          CancelSchema.extend({ profileId: z.string().min(1) }),
          await readJson(c.req.raw),
        ),
      ),
      202,
    ),
  );
  app.post("/api/v1/admin/profiles/:id/retire", async (c) =>
    c.json(
      await media.retireProfile(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(z.uuid(), c.req.param("id")),
        parseInput(
          z.strictObject({
            expectedVersion: z.int().nonnegative(),
            replacementId: z.uuid(),
            kind: z.enum(["movie", "series"]),
          }),
          await readJson(c.req.raw),
        ),
      ),
    ),
  );
}
