import type { Hono } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import {
  RequestInterestCommandSchema,
  LibraryKeepingCommandSchema,
} from "#shared/household/interests.ts";
import { IdempotencyKeySchema } from "#infrastructure/commands.ts";
import { parseInput, readJson } from "#server/validation.ts";
import type { RequestInterestCommands } from "#infrastructure/request-interest/commands.ts";
import type { listRequestInterests } from "#infrastructure/request-interest/read.ts";

export type RequestInterestApplication = {
  list: (
    actor: MediaActor,
    cursor: string | null,
  ) => ReturnType<typeof listRequestInterests>;
  execute: RequestInterestCommands["execute"];
  libraryPolicy: RequestInterestCommands["libraryPolicy"];
};
export function registerRequestInterestRoutes(
  app: Hono<{ Variables: { actor: MediaActor; requestId: string } }>,
  interest: RequestInterestApplication,
) {
  app.get("/api/v1/request-interests", async (c) =>
    c.json(
      await interest.list(
        c.get("actor"),
        parseInput(z.uuid().nullable(), c.req.query("cursor") ?? null),
      ),
    ),
  );
  app.post("/api/v1/request-interests/:id/commands", async (c) => {
    const input = parseInput(
      RequestInterestCommandSchema,
      await readJson(c.req.raw),
    );
    if (input.requestId !== c.req.param("id"))
      throw new MediaError(
        "command_scope_mismatch",
        "URL and request must agree",
        422,
      );
    return c.json(
      await interest.execute(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        input,
      ),
    );
  });
  app.post("/api/v1/library/:id/keeping-policy", async (c) => {
    const input = parseInput(
      LibraryKeepingCommandSchema,
      await readJson(c.req.raw),
    );
    if (input.mediaId !== c.req.param("id"))
      throw new MediaError(
        "command_scope_mismatch",
        "URL and media must agree",
        422,
      );
    return c.json(
      await interest.libraryPolicy(
        c.get("actor"),
        parseInput(IdempotencyKeySchema, c.req.header("Idempotency-Key")),
        input,
      ),
    );
  });
}
