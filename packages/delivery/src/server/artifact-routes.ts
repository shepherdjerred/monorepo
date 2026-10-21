import type { Hono } from "hono";
import {
  AcquireUpstreamArtifactSchema,
  FindQualifiedArtifactSchema,
} from "#shared/contract.ts";
import type { Principal } from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";
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
  app.post("/api/v1/artifacts/upstream", async (c) => {
    const input = AcquireUpstreamArtifactSchema.parse(await c.req.json());
    // An acquisition's order key (B4) only means something inside the configured CI repository.
    if (
      input.pipeline !== undefined &&
      input.pipeline.repositoryId !== options.repositoryId
    )
      throw new DeliveryError(
        "INVALID",
        "Acquisition pipeline must belong to the configured CI repository",
      );
    return c.json(
      await delivery.acquireUpstreamArtifact(
        input,
        c.get("principal"),
        options.transport === undefined ? {} : { transport: options.transport },
      ),
      201,
    );
  });
}
