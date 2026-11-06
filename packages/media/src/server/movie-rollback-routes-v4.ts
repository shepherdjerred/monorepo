import type { Hono } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { MovieRollbackAdministrationV1 } from "#application/movie-rollback-ports.ts";
import { MediaError } from "#application/errors.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import {
  MovieEditionKeySchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import { RequestMovieRollbackV1Schema } from "#shared/movie-editions/rollback/manual-command.ts";
import { RequestMovieRollbackRetryV1Schema } from "#shared/movie-editions/rollback/retry.ts";
import { parseInput, readJson } from "./validation.ts";

type App = Hono<{ Variables: { actor: MediaActor; requestId: string } }>;
const base = "/api/v4/media/:id/movie-editions/:edition/rollback";
export function registerMovieRollbackRoutesV4(
  app: App,
  service: MovieRollbackAdministrationV1,
) {
  app.get(base, async (c) => {
    const mediaId = parseInput(z.uuid(), c.req.param("id"));
    return c.json(
      await protectedCommand(() =>
        service.read(c.get("actor"), {
          rootMediaId: mediaId,
          mediaId,
          edition: parseInput(MovieEditionKeySchema, c.req.param("edition")),
        }),
      ),
    );
  });
  app.post(base, async (c) => {
    const input = parseInput(
      RequestMovieRollbackV1Schema,
      await readJson(c.req.raw),
    );
    assertScope(input.scope, c.req.param("id"), c.req.param("edition"));
    return c.json(
      await protectedCommand(() =>
        service.request(
          c.get("actor"),
          parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
          input,
        ),
      ),
      202,
    );
  });
  app.post(`${base}/retry`, async (c) => {
    const input = parseInput(
      RequestMovieRollbackRetryV1Schema,
      await readJson(c.req.raw),
    );
    assertScope(input.scope, c.req.param("id"), c.req.param("edition"));
    return c.json(
      await protectedCommand(() =>
        service.retry(
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
  if (
    scope.mediaId !== mediaId ||
    scope.rootMediaId !== mediaId ||
    scope.edition !== edition
  )
    throw new MediaError(
      "command_scope_mismatch",
      "URL and rollback review must select the same movie edition",
      409,
    );
}
async function protectedCommand<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FileGuardError)
      throw new MediaError(
        error.reason,
        "This movie's recovery state changed; review the current edition",
        409,
      );
    throw error;
  }
}
