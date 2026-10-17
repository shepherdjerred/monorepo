import type { Hono } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { PrismaLegacyRequesterBindings } from "#infrastructure/recovery/legacy-claims/service.ts";
import { BindLegacyRequesterSchema } from "#shared/recovery-claims.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import { parseInput, readJson } from "./validation.ts";
export type LegacyRequesterBindings = Pick<
  PrismaLegacyRequesterBindings,
  "list" | "bind"
>;
export function registerLegacyRequesterBindingRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  service: LegacyRequesterBindings,
) {
  app.get("/api/v1/admin/legacy-requester-bindings", async (c) =>
    c.json(
      await service.list(
        c.get("actor"),
        parseInput(z.uuid(), c.req.query("captureId")),
      ),
    ),
  );
  app.post("/api/v1/admin/legacy-requester-bindings", async (c) =>
    c.json(
      await service.bind(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(BindLegacyRequesterSchema, await readJson(c.req.raw)),
      ),
    ),
  );
}
