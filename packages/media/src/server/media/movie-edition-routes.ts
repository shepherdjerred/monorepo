import type { Hono } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { MediaApplication } from "#application/ports.ts";
import { MediaError } from "#application/errors.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import {
  MovieRequestV3Schema,
  CancelMovieRequestV3Schema,
  RevokeMovieEditionChoiceV3Schema,
} from "#shared/movie-editions/commands.ts";
import {
  MovieEditionContextQuerySchema,
  MovieEditionRequestListQuerySchema,
} from "#shared/movie-editions/view.ts";
import { parseInput, readJson } from "#server/validation.ts";
import { registerEditionCommandRoutes } from "./edition-routes.ts";

type CommandRouteOptions = {
  requireRequestsEnabled: () => Promise<void>;
  refreshProfileAccess: (actor: MediaActor, userId: string) => Promise<unknown>;
};

export function registerMediaEditionRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  media: MediaApplication,
  options: CommandRouteOptions,
) {
  registerEditionCommandRoutes(app, media, options);
  registerMovieEditionRoutes(app, media, options);
}

export function registerMovieEditionRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  media: MediaApplication,
  options: CommandRouteOptions,
) {
  app.get("/api/v3/media/:id/movie-edition-context", async (c) => {
    const query = parseInput(MovieEditionContextQuerySchema, c.req.query());
    const actor = c.get("actor");
    return c.json(
      await media.getMovieEditionContext(
        actor,
        parseInput(z.uuid(), c.req.param("id")),
        query.subjectUserId ?? actor.id,
      ),
    );
  });
  app.get("/api/v3/movie-requests", async (c) => {
    const query = parseInput(MovieEditionRequestListQuerySchema, c.req.query());
    const actor = c.get("actor");
    return c.json(
      await media.listMovieEditionRequests(actor, {
        subjectUserId: query.subjectUserId ?? actor.id,
        cursor: query.cursor ?? null,
      }),
    );
  });
  app.post("/api/v3/media/:id/movie-requests", async (c) => {
    const input = parseInput(MovieRequestV3Schema, await readJson(c.req.raw));
    assertPathScope(c.req.param("id"), input.mediaId);
    const actor = c.get("actor");
    return c.json(
      await media.requestMovieEdition(
        actor,
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        input,
        async () => {
          await options.requireRequestsEnabled();
          await refreshSubject(
            actor,
            input.subjectUserId,
            options.refreshProfileAccess,
          );
        },
      ),
    );
  });
  app.post("/api/v3/media/:id/movie-requests/:requestId/cancel", async (c) => {
    const input = parseInput(
      CancelMovieRequestV3Schema,
      await readJson(c.req.raw),
    );
    assertPathScope(c.req.param("id"), input.scope.mediaId);
    assertPathScope(c.req.param("requestId"), input.requestId);
    const actor = c.get("actor");
    return c.json(
      await media.cancelMovieEditionRequest(
        actor,
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        input,
        () =>
          refreshSubject(
            actor,
            input.subjectUserId,
            options.refreshProfileAccess,
          ),
      ),
    );
  });
  app.post(
    "/api/v3/media/:id/movie-requests/:requestId/revoke-choice",
    async (c) => {
      const input = parseInput(
        RevokeMovieEditionChoiceV3Schema,
        await readJson(c.req.raw),
      );
      assertPathScope(c.req.param("id"), input.scope.mediaId);
      assertPathScope(c.req.param("requestId"), input.requestId);
      const actor = c.get("actor");
      return c.json(
        await media.revokeMovieEditionChoice(
          actor,
          parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
          input,
          () =>
            refreshSubject(
              actor,
              input.subjectUserId,
              options.refreshProfileAccess,
            ),
        ),
      );
    },
  );
}

function assertPathScope(pathId: string, inputId: string): void {
  if (pathId !== inputId)
    throw new MediaError(
      "command_scope_mismatch",
      "URL and command target must agree",
      409,
    );
}

async function refreshSubject(
  actor: MediaActor,
  subjectUserId: string,
  refresh: (actor: MediaActor, userId: string) => Promise<unknown>,
): Promise<void> {
  if (actor.id !== subjectUserId) await refresh(actor, subjectUserId);
}
