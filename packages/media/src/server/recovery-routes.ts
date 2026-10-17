import type { Hono } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { PrismaRecovery } from "#infrastructure/recovery/service.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import {
  PrepareRecoverySchema,
  RespondRecoverySchema,
  ReleaseRecoverySchema,
} from "#shared/recovery.ts";
import { parseInput, readJson } from "./validation.ts";

export type RecoveryAdministration = Pick<
  PrismaRecovery,
  "list" | "detail" | "prepare" | "respond" | "release"
>;
export function registerRecoveryRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  recovery: RecoveryAdministration,
) {
  app.get("/api/v1/recovery", async (c) =>
    c.json(await recovery.list(c.get("actor"))),
  );
  app.get("/api/v1/recovery/reviews/:id", async (c) =>
    c.json(
      await recovery.detail(
        c.get("actor"),
        parseInput(z.uuid(), c.req.param("id")),
      ),
    ),
  );
  app.post("/api/v1/recovery/reviews", async (c) =>
    c.json(
      await recovery.prepare(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(PrepareRecoverySchema, await readJson(c.req.raw)),
      ),
    ),
  );
  app.post("/api/v1/recovery/reviews/:id/responses", async (c) =>
    c.json(
      await recovery.respond(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(z.uuid(), c.req.param("id")),
        parseInput(RespondRecoverySchema, await readJson(c.req.raw)),
      ),
    ),
  );
  app.post("/api/v1/recovery/reviews/:id/release", async (c) =>
    c.json(
      await recovery.release(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(z.uuid(), c.req.param("id")),
        parseInput(ReleaseRecoverySchema, await readJson(c.req.raw)),
      ),
    ),
  );
}
