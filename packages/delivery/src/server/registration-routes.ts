import type { Hono } from "hono";
import { z } from "zod";
import {
  IdentifierSchema,
  PipelineDefinitionSchema,
  RegisterEnvironmentSchema,
  type Principal,
} from "#shared/contract.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";

export function registerDefinitionRoutes(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  delivery: Delivery,
) {
  app.post("/api/v1/pipelines", async (c) => {
    requireScope(c.get("principal"), "admin");
    const input = z
      .object({ id: IdentifierSchema, definition: PipelineDefinitionSchema })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await delivery.registerPipeline(
        input.id,
        input.definition,
        c.get("principal"),
      ),
      201,
    );
  });
  app.post("/api/v1/environments", async (c) => {
    requireScope(c.get("principal"), "admin");
    return c.json(
      await delivery.registerEnvironment(
        RegisterEnvironmentSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
      201,
    );
  });
}
