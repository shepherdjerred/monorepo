import type { Hono } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { MovieHistoryAdministration } from "#application/movie-history-ports.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import {
  PrepareMovieHistoryV3Schema,
  RespondMovieHistoryV3Schema,
  ReleaseMovieHistoryV3Schema,
} from "#shared/movie-editions/history-review-v3.ts";
import { parseInput, readJson } from "./validation.ts";

const ScopeQuery = z.strictObject({
  mediaId: z.uuid(),
  edition: MovieEditionKeySchema,
});
const DiscoveryQuery = ScopeQuery.partial().refine(
  (value) => (value.mediaId === undefined) === (value.edition === undefined),
  "Select both the movie and its visible cut",
);
const scope = (input: z.infer<typeof ScopeQuery>) => ({
  rootMediaId: input.mediaId,
  ...input,
});

/** Exact scoped review protocol; historical recovery routes retain their original bodies. */
export function registerMovieHistoryRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  history: MovieHistoryAdministration,
) {
  app.get("/api/v3/movie-history/context", async (c) =>
    c.json(
      await history.context(
        c.get("actor"),
        scope(parseInput(ScopeQuery, c.req.query())),
      ),
    ),
  );
  app.get("/api/v3/movie-history/reviews", async (c) => {
    const input = parseInput(DiscoveryQuery, c.req.query());
    return c.json(
      await history.list(
        c.get("actor"),
        input.mediaId === undefined || input.edition === undefined
          ? {}
          : {
              scope: scope({ mediaId: input.mediaId, edition: input.edition }),
            },
      ),
    );
  });
  app.get("/api/v3/movie-history/reviews/:id", async (c) =>
    c.json(
      await history.detail(
        c.get("actor"),
        parseInput(z.uuid(), c.req.param("id")),
      ),
    ),
  );
  app.post("/api/v3/movie-history/reviews", async (c) =>
    c.json(
      await history.prepare(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(PrepareMovieHistoryV3Schema, await readJson(c.req.raw)),
      ),
    ),
  );
  app.post("/api/v3/movie-history/reviews/:id/responses", async (c) =>
    c.json(
      await history.respond(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(z.uuid(), c.req.param("id")),
        parseInput(RespondMovieHistoryV3Schema, await readJson(c.req.raw)),
      ),
    ),
  );
  app.post("/api/v3/movie-history/reviews/:id/release", async (c) =>
    c.json(
      await history.release(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        parseInput(z.uuid(), c.req.param("id")),
        parseInput(ReleaseMovieHistoryV3Schema, await readJson(c.req.raw)),
      ),
    ),
  );
}
