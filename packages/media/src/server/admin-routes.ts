import type { Hono } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { PrismaAdminApplication } from "#infrastructure/admin-service.ts";
import {
  AdminProviderIdSchema,
  SaveProviderSchema,
  ManualSubtitleSchema,
  SubtitleTargetListSchema,
} from "#shared/admin.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import { parseInput, readJson } from "./validation.ts";

export type AdminApplication = Pick<
  PrismaAdminApplication,
  "providers" | "saveProvider" | "subtitleTargets" | "uploadSubtitle"
>;

/** Register after the application's authenticated, CSRF-protected /api middleware. */
export function registerAdminRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  admin: AdminApplication,
): void {
  app.get("/api/v1/admin/providers", async (c) =>
    c.json(await admin.providers(c.get("actor"))),
  );
  app.put("/api/v1/admin/providers/:id", async (c) =>
    c.json(
      await admin.saveProvider(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(AdminProviderIdSchema, c.req.param("id")),
        parseInput(SaveProviderSchema, await readJson(c.req.raw)),
      ),
    ),
  );
  app.get("/api/v1/admin/subtitles/targets", async (c) =>
    c.json(
      SubtitleTargetListSchema.parse(
        await admin.subtitleTargets(
          c.get("actor"),
          parseInput(z.string().max(200), c.req.query("q") ?? ""),
        ),
      ),
    ),
  );
  app.post("/api/v1/admin/subtitles", async (c) =>
    c.json(
      await admin.uploadSubtitle(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(ManualSubtitleSchema, await readJson(c.req.raw)),
      ),
      202,
    ),
  );
}
