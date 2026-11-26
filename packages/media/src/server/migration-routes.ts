import type { Hono } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { PrismaMigrationAdministration } from "#migration/persistence.ts";
import {
  UploadMigrationSchema,
  ReviewMigrationSchema,
} from "#shared/migration.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import { parseInput, readJson } from "./validation.ts";
import { ReviewBundleSchema } from "#shared/migration-handoff.ts";
import { CreateBundleProtocolSchema } from "#shared/handoff/library-bundle.ts";
import { DiscoverMigrationCatalogSchema } from "#shared/migration-catalog.ts";
import { registerPersonalMigrationRoutes } from "./personal-migration/routes.ts";
import { LegacyActivityImportSchema } from "#shared/legacy-activity/contract.ts";
const ActivityUploadMarkerSchema = z.object({
  kind: LegacyActivityImportSchema.shape.kind,
});
export type MigrationAdministration = Pick<
  PrismaMigrationAdministration,
  "list" | "detail" | "upload" | "review" | "discover" | "importActivity"
> & {
  personal?: Pick<
    PrismaMigrationAdministration["personal"],
    | "preview"
    | "apply"
    | "imported"
    | "importedHistory"
    | "attachImportedRequests"
    | "reconcile"
    | "passive"
  >;
  bundles: Pick<
    PrismaMigrationAdministration["bundles"],
    "create" | "list" | "detail" | "review"
  >;
};
export function registerMigrationRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  migration: MigrationAdministration,
): void {
  if (migration.personal !== undefined)
    registerPersonalMigrationRoutes(app, migration.personal);
  app.get("/api/v1/admin/migration/bundles", async (c) =>
    c.json(await migration.bundles.list(c.get("actor"))),
  );
  app.get("/api/v1/admin/migration/bundles/:id", async (c) =>
    c.json(
      await migration.bundles.detail(
        c.get("actor"),
        parseInput(z.uuid(), c.req.param("id")),
      ),
    ),
  );
  app.post("/api/v1/admin/migration/bundles", async (c) =>
    c.json(
      await migration.bundles.create(
        c.get("actor"),
        parseInput(CreateBundleProtocolSchema, await readJson(c.req.raw)),
      ),
    ),
  );
  app.post("/api/v1/admin/migration/bundles/:id/review", async (c) =>
    c.json(
      await migration.bundles.review(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(z.uuid(), c.req.param("id")),
        parseInput(ReviewBundleSchema, await readJson(c.req.raw)),
      ),
    ),
  );
  app.post("/api/v1/admin/migration/captures/:id/discover", async (c) =>
    c.json(
      await migration.discover(
        c.get("actor"),
        parseInput(z.uuid(), c.req.param("id")),
        parseInput(DiscoverMigrationCatalogSchema, await readJson(c.req.raw)),
      ),
    ),
  );
  app.get("/api/v1/admin/migration", async (c) =>
    c.json(await migration.list(c.get("actor"))),
  );
  app.get("/api/v1/admin/migration/:id", async (c) =>
    c.json(
      await migration.detail(
        c.get("actor"),
        parseInput(z.uuid(), c.req.param("id")),
      ),
    ),
  );
  app.post("/api/v1/admin/migration", async (c) => {
    const body = await readJson(c.req.raw);
    const actor = c.get("actor");
    return ActivityUploadMarkerSchema.safeParse(body).success
      ? c.json(
          await migration.importActivity(
            actor,
            parseInput(LegacyActivityImportSchema, body),
          ),
        )
      : c.json(
          await migration.upload(
            actor,
            parseInput(UploadMigrationSchema, body),
          ),
        );
  });
  app.post("/api/v1/admin/migration/:id/review", async (c) =>
    c.json(
      await migration.review(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(z.uuid(), c.req.param("id")),
        parseInput(ReviewMigrationSchema, await readJson(c.req.raw)),
      ),
    ),
  );
}
