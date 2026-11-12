import type { Hono } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { PrismaExternalLibraryRegistration } from "#infrastructure/external-library/registration/service.ts";
import type { createExternalEditionCorrection } from "#infrastructure/external-library/edition/correction.ts";
import {
  ExternalEditionTargetSchema,
  ExternalEditionApplySchema,
} from "#infrastructure/external-library/edition/contract.ts";
import {
  ExternalLibraryPreviewInputSchema,
  ExternalLibraryApplyInputSchema,
} from "#shared/external-library/contract.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import { parseInput, readJson } from "./validation.ts";

export type ExternalLibraryAdministration = {
  registration: Pick<
    PrismaExternalLibraryRegistration,
    "items" | "preview" | "apply"
  >;
  edition: (
    actor: MediaActor,
  ) => Promise<ReturnType<typeof createExternalEditionCorrection>>;
};

export function registerExternalLibraryRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  external: ExternalLibraryAdministration | undefined,
) {
  if (external === undefined) return;
  app.get("/api/v1/admin/external-library/items", async (c) =>
    c.json(
      await external.registration.items(
        c.get("actor"),
        parseInput(z.enum(["movie", "show"]), c.req.query("sectionType")),
        parseInput(
          z.coerce.number().int().nonnegative().max(1_000_000),
          c.req.query("offset") ?? "0",
        ),
      ),
    ),
  );
  app.post("/api/v1/admin/external-library/preview", async (c) =>
    c.json(
      await external.registration.preview(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(
          ExternalLibraryPreviewInputSchema,
          await readJson(c.req.raw),
        ),
      ),
    ),
  );
  app.post("/api/v1/admin/external-library/apply", async (c) =>
    c.json(
      await external.registration.apply(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(ExternalLibraryApplyInputSchema, await readJson(c.req.raw)),
      ),
    ),
  );
  app.post("/api/v1/admin/external-library/edition-preview", async (c) => {
    const actor = c.get("actor");
    const input = parseInput(
      ExternalEditionTargetSchema,
      await readJson(c.req.raw),
    );
    const edition = await external.edition(actor);
    return c.json(await edition.preview(actor, input));
  });
  app.post("/api/v1/admin/external-library/edition-apply", async (c) => {
    const actor = c.get("actor");
    const input = parseInput(
      ExternalEditionApplySchema,
      await readJson(c.req.raw),
    );
    const edition = await external.edition(actor);
    return c.json(await edition.apply(actor, input));
  });
}
