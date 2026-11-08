import type { Hono } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { MovieSubtitleReplacementAdministrationV2 } from "#application/movie-subtitle-replacement-ports.ts";
import { MediaError } from "#application/errors.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import {
  MovieEditionKeySchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import {
  MovieManualReplacementV2Schema,
  MoviePrepareReplacementV2Schema,
} from "#shared/movie-editions/subtitle-replacement-v2.ts";
import { parseInput, readJson } from "./validation.ts";

type App = Hono<{ Variables: { actor: MediaActor; requestId: string } }>;
const base = "/api/v2/media/:id/movie-editions/:edition";

export function registerMovieSubtitleReplacementRoutesV2(
  app: App,
  service: MovieSubtitleReplacementAdministrationV2,
) {
  app.get(`${base}/subtitle-target`, async (c) => {
    const mediaId = parseInput(z.uuid(), c.req.param("id"));
    return c.json(
      await expected(() =>
        service.context(c.get("actor"), {
          rootMediaId: mediaId,
          mediaId,
          edition: parseInput(MovieEditionKeySchema, c.req.param("edition")),
        }),
      ),
    );
  });
  app.post(`${base}/subtitle-replacements/candidates`, async (c) => {
    const input = parseInput(
      MovieManualReplacementV2Schema,
      await readJson(c.req.raw),
    );
    assertScope(input.scope, c.req.param("id"), c.req.param("edition"));
    return c.json(
      await expected(() =>
        service.upload(
          c.get("actor"),
          parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
          input,
        ),
      ),
    );
  });
  app.post(`${base}/subtitle-replacements`, async (c) => {
    const input = parseInput(
      MoviePrepareReplacementV2Schema,
      await readJson(c.req.raw),
    );
    assertScope(input.scope, c.req.param("id"), c.req.param("edition"));
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
}

function assertScope(
  scope: MovieEditionScope,
  mediaId: string,
  edition: string,
) {
  if (scope.mediaId !== mediaId || scope.edition !== edition)
    throw new MediaError(
      "command_scope_mismatch",
      "URL and caption replacement must select the same edition",
      409,
    );
}

async function expected<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FileGuardError)
      throw new MediaError(
        error.reason,
        "Caption replacement is protected; review this edition's current state",
        409,
      );
    throw error;
  }
}
