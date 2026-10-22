import type { Hono } from "hono";
import { z } from "zod";
import {
  IdentifierSchema,
  PipelineDefinitionSchema,
  RegisterEnvironmentSchema,
  type Principal,
} from "#shared/contract.ts";
import { RetireServiceRequestSchema } from "#shared/model/route-contract.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { reconcileSummary } from "#infrastructure/catalog/reconcile.ts";
import { catalogState } from "#infrastructure/catalog/state.ts";

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
  app.post("/api/v1/catalog/reconcile", async (c) => {
    requireScope(c.get("principal"), "admin");
    const body: unknown = await c.req.json();
    return c.json(
      reconcileSummary(
        await delivery.reconcileCatalog(body, c.get("principal")),
      ),
    );
  });
  app.get("/api/v1/catalog", async (c) => {
    requireScope(c.get("principal"), "read");
    return c.json(await catalogState(delivery.database));
  });
  app.post("/api/v1/services/:id/retire", async (c) =>
    c.json(
      await delivery.retireService(
        c.req.param("id"),
        RetireServiceRequestSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    ),
  );
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
