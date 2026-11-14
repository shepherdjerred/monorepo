import type { Hono } from "hono";
import type { MediaActor } from "#application/auth.ts";
import type { PrismaQualityGuideAdministration } from "#infrastructure/quality-guide/service.ts";
import {
  QualityGuideApplySchema,
  QualityGuidePreviewSchema,
} from "#shared/quality-guide/contract.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import { parseInput, readJson } from "#server/validation.ts";

export function registerQualityGuideRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  service: Pick<
    PrismaQualityGuideAdministration,
    "status" | "preview" | "apply"
  >,
) {
  app.get("/api/v1/admin/quality-guide", async (c) =>
    c.json(await service.status(c.get("actor"))),
  );
  app.post("/api/v1/admin/quality-guide/preview", async (c) =>
    c.json(
      await service.preview(
        c.get("actor"),
        parseInput(QualityGuidePreviewSchema, await readJson(c.req.raw)),
      ),
    ),
  );
  app.post("/api/v1/admin/quality-guide/apply", async (c) =>
    c.json(
      await service.apply(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(QualityGuideApplySchema, await readJson(c.req.raw)),
      ),
    ),
  );
}
