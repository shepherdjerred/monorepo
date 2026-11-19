import type { Hono } from "hono";
import type { MediaActor } from "#application/auth.ts";
import type { PrismaPersonalMigration } from "#migration/personal-state/service.ts";
import {
  PersonalMigrationInputSchema,
  ApplyPersonalMigrationSchema,
  ReconcilePersonalMigrationSchema,
} from "#shared/personal-migration/contract.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import { parseInput, readJson } from "#server/validation.ts";
import { PassiveRegistrationPreviewInputSchema } from "#shared/handoff/passive-registration.ts";

export function registerPersonalMigrationRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  migration: Pick<
    PrismaPersonalMigration,
    "preview" | "apply" | "imported" | "reconcile" | "passive"
  >,
) {
  app.get("/api/v1/admin/migration/personal/passive", async (c) =>
    c.json(
      await migration.passive(
        c.get("actor"),
        parseInput(PassiveRegistrationPreviewInputSchema, {
          bundleReviewId: c.req.query("bundleReviewId"),
          bundleReviewVersion: Number(c.req.query("bundleReviewVersion")),
          selected: c.req.queries("provenanceKey") ?? [],
        }),
      ),
    ),
  );
  app.get("/api/v1/requests/imported", async (c) =>
    c.json(await migration.imported(c.get("actor"))),
  );
  app.post("/api/v1/admin/migration/personal/preview", async (c) =>
    c.json(
      await migration.preview(
        c.get("actor"),
        parseInput(PersonalMigrationInputSchema, await readJson(c.req.raw)),
      ),
    ),
  );
  app.post("/api/v1/admin/migration/personal/apply", async (c) =>
    c.json(
      await migration.apply(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(ApplyPersonalMigrationSchema, await readJson(c.req.raw)),
      ),
    ),
  );
  app.post("/api/v1/admin/migration/personal/reconcile", async (c) =>
    c.json(
      await migration.reconcile(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(ReconcilePersonalMigrationSchema, await readJson(c.req.raw)),
      ),
    ),
  );
}
