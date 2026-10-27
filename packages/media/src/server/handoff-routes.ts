import type { Hono } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { PrismaMediaHandoff } from "#infrastructure/handoff/service.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import {
  ApplyHandoffProtocolSchema,
  PrepareHandoffProtocolSchema,
} from "#shared/handoff-v2.ts";
import { parseInput, readJson } from "./validation.ts";

export type HandoffAdministration = Pick<
  PrismaMediaHandoff,
  "prepare" | "detail" | "apply"
>;

export function registerHandoffRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  handoff: HandoffAdministration,
) {
  app.post("/api/v1/admin/handoffs", async (c) =>
    c.json(
      await handoff.prepare(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(PrepareHandoffProtocolSchema, await readJson(c.req.raw)),
      ),
      202,
    ),
  );
  app.get("/api/v1/admin/handoffs/:id", async (c) =>
    c.json(
      await handoff.detail(
        c.get("actor"),
        parseInput(z.uuid(), c.req.param("id")),
      ),
    ),
  );
  app.post("/api/v1/admin/handoffs/:id/apply", async (c) =>
    c.json(
      await handoff.apply(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(z.uuid(), c.req.param("id")),
        parseInput(ApplyHandoffProtocolSchema, await readJson(c.req.raw)),
      ),
      202,
    ),
  );
}
