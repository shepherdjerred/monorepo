import type { Hono } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { MovieLifecycleApplicationV4 } from "#application/movie-lifecycle-ports-v4.ts";
import { MediaError } from "#application/errors.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import {
  MovieEditionContextQuerySchema,
  MovieEditionRequestListQuerySchema,
} from "#shared/movie-editions/view.ts";
import {
  MovieRequestV4Schema,
  CancelMovieRequestV4Schema,
  RevokeMovieEditionChoiceV4Schema,
  MovieLifecycleCommandV4Schema,
} from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import { ActivateMovieEditionChoiceV4Schema } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { parseInput, readJson } from "#server/validation.ts";

type App = Hono<{ Variables: { actor: MediaActor; requestId: string } }>;
type Options = {
  requireRequestsEnabled: () => Promise<void>;
  refreshProfileAccess: (actor: MediaActor, userId: string) => Promise<unknown>;
};

/** Register atomically with the complete v4 application; session and CSRF middleware belong to createMediaApp. */
export function registerMovieLifecycleRoutesV4(
  app: App,
  media: MovieLifecycleApplicationV4,
  options: Options,
) {
  app.get("/api/v4/media/:id/movie-edition-context", async (c) => {
    const query = parseInput(MovieEditionContextQuerySchema, c.req.query());
    const actor = c.get("actor");
    return c.json(
      await media.getMovieEditionContextV4(
        actor,
        parseInput(z.uuid(), c.req.param("id")),
        query.subjectUserId ?? actor.id,
      ),
    );
  });
  app.get("/api/v4/movie-requests", async (c) => {
    const query = parseInput(MovieEditionRequestListQuerySchema, c.req.query());
    const actor = c.get("actor");
    return c.json(
      await media.listMovieEditionRequestsV4(actor, {
        subjectUserId: query.subjectUserId ?? actor.id,
        cursor: query.cursor ?? null,
      }),
    );
  });
  app.get("/api/v4/media/:id/movie-editions/:edition", async (c) => {
    const mediaId = parseInput(z.uuid(), c.req.param("id"));
    return c.json(
      await media.getMovieTargetContextV4(c.get("actor"), {
        mediaId,
        rootMediaId: mediaId,
        edition: parseInput(MovieEditionKeySchema, c.req.param("edition")),
      }),
    );
  });
  registerMovieRequestsV4(app, media, options);
  app.post("/api/v4/media/:id/movie-editions/:edition/actions", async (c) => {
    const input = parseInput(
      MovieLifecycleCommandV4Schema,
      await readJson(c.req.raw),
    );
    assertPath(c.req.param("id"), input.scope.mediaId);
    assertPath(c.req.param("edition"), input.scope.edition);
    const actor = c.get("actor");
    return c.json(
      await media.executeMovieLifecycleV4(
        actor,
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        input,
        async () => {
          if (
            input.command.action === "retry" ||
            input.command.action === "select_release"
          )
            await options.requireRequestsEnabled();
        },
      ),
    );
  });
}

function registerMovieRequestsV4(
  app: App,
  media: MovieLifecycleApplicationV4,
  options: Options,
) {
  app.post("/api/v4/media/:id/movie-requests", async (c) => {
    const input = parseInput(MovieRequestV4Schema, await readJson(c.req.raw));
    assertPath(c.req.param("id"), input.mediaId);
    const actor = c.get("actor");
    return c.json(
      await media.requestMovieEditionV4(
        actor,
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        input,
        async () => {
          await options.requireRequestsEnabled();
          await refreshSubject(actor, input.subjectUserId, options);
        },
      ),
    );
  });
  app.post("/api/v4/media/:id/movie-requests/:requestId/cancel", async (c) => {
    const input = parseInput(
      CancelMovieRequestV4Schema,
      await readJson(c.req.raw),
    );
    assertPath(c.req.param("id"), input.scope.mediaId);
    assertPath(c.req.param("requestId"), input.requestId);
    const actor = c.get("actor");
    return c.json(
      await media.cancelMovieEditionRequestV4(
        actor,
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        input,
        () => refreshSubject(actor, input.subjectUserId, options),
      ),
    );
  });
  app.post(
    "/api/v4/media/:id/movie-requests/:requestId/revoke-choice",
    async (c) => {
      const input = parseInput(
        RevokeMovieEditionChoiceV4Schema,
        await readJson(c.req.raw),
      );
      assertPath(c.req.param("id"), input.scope.mediaId);
      assertPath(c.req.param("requestId"), input.requestId);
      const actor = c.get("actor");
      return c.json(
        await media.revokeMovieEditionChoiceV4(
          actor,
          parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
          input,
          () => refreshSubject(actor, input.subjectUserId, options),
        ),
      );
    },
  );
  app.post(
    "/api/v4/media/:id/movie-requests/:requestId/activate-choice",
    async (c) => {
      const input = parseInput(
        ActivateMovieEditionChoiceV4Schema,
        await readJson(c.req.raw),
      );
      assertPath(c.req.param("id"), input.scope.mediaId);
      assertPath(c.req.param("requestId"), input.requestId);
      const actor = c.get("actor");
      return c.json(
        await media.activateMovieEditionChoiceV4(
          actor,
          parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
          input,
          async () => {
            await options.requireRequestsEnabled();
            await refreshSubject(actor, input.subjectUserId, options);
          },
        ),
      );
    },
  );
}

function assertPath(actual: string, expected: string) {
  if (actual !== expected)
    throw new MediaError(
      "command_scope_mismatch",
      "URL and movie command scope must agree",
      409,
    );
}

async function refreshSubject(
  actor: MediaActor,
  userId: string,
  options: Options,
) {
  if (actor.id !== userId) await options.refreshProfileAccess(actor, userId);
}
