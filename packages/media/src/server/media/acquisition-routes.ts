import type { Hono } from "hono";
import type { MediaActor } from "#application/auth.ts";
import type { MediaApplication } from "#application/ports.ts";
import { MediaActionSchema } from "#shared/contract.ts";
import { IdentityPreviewInputSchema } from "#shared/acquisition/preview.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import { parseInput, readJson } from "#server/validation.ts";

export function registerAcquisitionRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  media: MediaApplication,
  requireRequestsEnabled: () => Promise<void>,
) {
  app.post("/api/v1/media/:id/actions", async (c) => {
    const input = parseInput(MediaActionSchema, await readJson(c.req.raw));
    if (input.action === "retry" || input.action === "select_release")
      await requireRequestsEnabled();
    return c.json(
      await media.act(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        c.req.param("id"),
        input,
      ),
      202,
    );
  });
  app.post(
    "/api/v1/media/:id/releases/:releaseId/identity-preview",
    async (c) =>
      c.json(
        await media.identityPreview(
          c.get("actor"),
          c.req.param("id"),
          c.req.param("releaseId"),
          parseInput(IdentityPreviewInputSchema, await readJson(c.req.raw)),
        ),
      ),
  );
  app.get("/api/v1/media/:id/releases", async (c) =>
    c.json(await media.releases(c.get("actor"), c.req.param("id"))),
  );
}
