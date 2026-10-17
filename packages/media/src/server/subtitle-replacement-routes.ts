import type { Hono } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { PrismaSubtitleReplacements } from "#infrastructure/subtitle-replacement/service.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import {
  PrepareSubtitleReplacementSchema,
  ApplySubtitleReplacementSchema,
  ReconcileSubtitleReplacementSchema,
} from "#shared/subtitle-replacement.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { MediaError } from "#application/errors.ts";
import { parseInput, readJson } from "./validation.ts";

export type SubtitleReplacementAdministration = Pick<
  PrismaSubtitleReplacements,
  "list" | "detail" | "prepare" | "apply" | "reconcile"
>;
async function expected<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FileGuardError)
      throw new MediaError(
        error.reason,
        "Subtitle replacement is protected; inspect current authority and participants",
        409,
      );
    throw error;
  }
}
export function registerSubtitleReplacementRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  service: SubtitleReplacementAdministration,
) {
  app.get("/api/v1/admin/subtitle-replacements", async (c) =>
    c.json(
      await expected(() =>
        service.list(
          c.get("actor"),
          parseInput(z.uuid().nullable(), c.req.query("cursor") ?? null),
        ),
      ),
    ),
  );
  app.get("/api/v1/admin/subtitle-replacements/:id", async (c) =>
    c.json(
      await expected(() =>
        service.detail(c.get("actor"), parseInput(z.uuid(), c.req.param("id"))),
      ),
    ),
  );
  app.post("/api/v1/admin/subtitle-replacements", async (c) => {
    const input = parseInput(
      PrepareSubtitleReplacementSchema,
      await readJson(c.req.raw),
    );
    return c.json(
      await expected(() =>
        service.prepare(
          c.get("actor"),
          parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
          input,
        ),
      ),
      202,
    );
  });
  app.post("/api/v1/admin/subtitle-replacements/:id/apply", async (c) => {
    const input = parseInput(
      ApplySubtitleReplacementSchema,
      await readJson(c.req.raw),
    );
    return c.json(
      await expected(() =>
        service.apply(
          c.get("actor"),
          parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
          parseInput(z.uuid(), c.req.param("id")),
          input,
        ),
      ),
      202,
    );
  });
  app.post("/api/v1/admin/subtitle-replacements/:id/reconcile", async (c) => {
    const input = parseInput(
      ReconcileSubtitleReplacementSchema,
      await readJson(c.req.raw),
    );
    return c.json(
      await expected(() =>
        service.reconcile(
          c.get("actor"),
          parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
          parseInput(z.uuid(), c.req.param("id")),
          input,
        ),
      ),
      202,
    );
  });
}
