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
import { PrepareNativeQuarantineSchema } from "#shared/native-recovery/quarantine.ts";
import { PrepareNativeArchiveSchema } from "#shared/native-recovery/archive.ts";

export type NativeRecoveryAdministration = Pick<
  PrismaNativeRecovery,
  | "inventory"
  | "prepare"
  | "prepareQuarantine"
  | "prepareArchive"
  | "archiveInventory"
  | "detail"
  | "apply"
>;
export function registerNativeRecoveryRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  service: NativeRecoveryAdministration,
) {
  app.get("/api/v1/admin/native-recovery/archives", async (c) =>
    c.json(
      await service.archiveInventory(
        c.get("actor"),
        parseInput(z.uuid().nullable(), c.req.query("cursor") ?? null),
      ),
    ),
  );
  app.post("/api/v1/admin/native-recovery/archives", async (c) =>
    c.json(
      await service.prepareArchive(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(PrepareNativeArchiveSchema, await readJson(c.req.raw)),
      ),
      202,
    ),
  );
  app.post("/api/v1/admin/native-recovery/quarantine", async (c) =>
    c.json(
      await service.prepareQuarantine(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(PrepareNativeQuarantineSchema, await readJson(c.req.raw)),
      ),
      202,
    ),
  );
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
