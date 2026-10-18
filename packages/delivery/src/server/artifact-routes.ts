import type { Hono } from "hono";
import {
  AcquireUpstreamArtifactSchema,
  FindQualifiedArtifactSchema,
} from "#shared/contract.ts";
import type { Principal } from "#shared/contract.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import type { UpstreamFetch } from "#infrastructure/upstream-artifact.ts";

export function registerArtifactRoutes(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  delivery: Delivery,
  options: { repositoryId: number; transport?: UpstreamFetch },
) {
  app.get("/api/v1/artifacts/qualified-exact", async (c) =>
    c.json(
      await delivery.findQualifiedArtifact(
        FindQualifiedArtifactSchema.parse(c.req.query()),
        options.repositoryId,
      ),
    ),
  );
  app.post("/api/v1/artifacts/upstream", async (c) =>
    c.json(
      await delivery.acquireUpstreamArtifact(
        AcquireUpstreamArtifactSchema.parse(await c.req.json()),
        c.get("principal"),
        options.transport,
      ),
      201,
    ),
  );
}
