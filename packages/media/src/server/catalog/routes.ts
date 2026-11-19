import type { Hono } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { CatalogApplication } from "#application/ports.ts";
import { MediaError } from "#application/errors.ts";
import { parseInput, readJson } from "#server/validation.ts";

const AdoptSchema = z.strictObject({
  kind: z.enum(["movie", "series"]),
  externalId: z.number().int().positive(),
});

export function registerCatalogRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  catalog: CatalogApplication,
  requireRequestsEnabled: () => Promise<void>,
) {
  app.get("/api/v1/catalog/search", async (c) =>
    c.json(
      await catalog.search(
        parseInput(z.string().min(1).max(200), c.req.query("q")),
      ),
    ),
  );
  app.get("/api/v1/catalog/:kind/:id", async (c) =>
    c.json(
      await catalog.details(
        parseInput(z.enum(["movie", "series"]), c.req.param("kind")),
        parseInput(z.coerce.number().int().positive(), c.req.param("id")),
      ),
    ),
  );
  app.post("/api/v1/catalog/adopt", async (c) => {
    await requireRequestsEnabled();
    const input = parseInput(AdoptSchema, await readJson(c.req.raw));
    if (c.get("actor").restricted)
      throw new MediaError(
        "requests_restricted",
        "This account cannot add catalog items",
        403,
      );
    return c.json(await catalog.adopt(input.kind, input.externalId), 201);
  });
}
