import type { Hono } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { PrismaNativeRecovery } from "#infrastructure/native-recovery/service.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import {
  PrepareNativeRecoverySchema,
  ApplyNativeRecoverySchema,
} from "#shared/native-recovery.ts";
import { parseInput, readJson } from "./validation.ts";

export type NativeRecoveryAdministration = Pick<
  PrismaNativeRecovery,
  "inventory" | "prepare" | "detail" | "apply"
>;
export function registerNativeRecoveryRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  service: NativeRecoveryAdministration,
) {
  app.get("/api/v1/admin/native-recovery", async (c) =>
    c.json(
      await service.inventory(
        c.get("actor"),
        parseInput(z.uuid().nullable(), c.req.query("cursor") ?? null),
      ),
    ),
  );
  app.post("/api/v1/admin/native-recovery", async (c) =>
    c.json(
      await service.prepare(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(PrepareNativeRecoverySchema, await readJson(c.req.raw)),
      ),
      202,
    ),
  );
  app.get("/api/v1/admin/native-recovery/:id", async (c) =>
    c.json(
      await service.detail(
        c.get("actor"),
        parseInput(z.uuid(), c.req.param("id")),
      ),
    ),
  );
  app.post("/api/v1/admin/native-recovery/:id/apply", async (c) =>
    c.json(
      await service.apply(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(z.uuid(), c.req.param("id")),
        parseInput(ApplyNativeRecoverySchema, await readJson(c.req.raw)),
      ),
      202,
    ),
  );
}
