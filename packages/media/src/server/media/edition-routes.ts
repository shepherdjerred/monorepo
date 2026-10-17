import type { Hono } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { MediaApplication } from "#application/ports.ts";
import { MediaError } from "#application/errors.ts";
import { DefaultCommandV2Schema } from "#shared/editions/commands.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import { parseInput, readJson } from "#server/validation.ts";

export function registerEditionCommandRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  media: MediaApplication,
  options: {
    requireRequestsEnabled: () => Promise<void>;
    refreshProfileAccess: (
      actor: MediaActor,
      userId: string,
    ) => Promise<unknown>;
  },
) {
  app.get("/api/v2/media/:id/targets/default", async (c) =>
    c.json(
      await media.getDefaultCommandContext(
        c.get("actor"),
        parseInput(z.uuid(), c.req.param("id")),
      ),
    ),
  );
  app.post("/api/v2/media/:id/commands", async (c) => {
    const input = parseInput(DefaultCommandV2Schema, await readJson(c.req.raw));
    if (input.scope.mediaId !== c.req.param("id"))
      throw new MediaError(
        "command_scope_mismatch",
        "URL and command target must agree",
        422,
      );
    const actor = c.get("actor");
    return c.json(
      await media.executeDefaultCommand(
        actor,
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        input,
        async () => {
          if (
            ["request", "retry", "select_release"].includes(
              input.command.action,
            )
          )
            await options.requireRequestsEnabled();
          if (
            input.command.action === "request" &&
            input.command.requesterUserId !== undefined &&
            input.command.requesterUserId !== actor.id
          )
            await options.refreshProfileAccess(
              actor,
              input.command.requesterUserId,
            );
        },
      ),
    );
  });
}
