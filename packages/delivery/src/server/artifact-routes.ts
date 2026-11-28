import type { Hono } from "hono";
import {
  AcquireUpstreamArtifactSchema,
  FindQualifiedArtifactSchema,
  LatestQualifiedArtifactQuerySchema,
  LatestRetainableArtifactQuerySchema,
} from "#shared/contract.ts";
import type { Principal } from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import type { QualificationRequest } from "#infrastructure/qualification.ts";
import type { UpstreamFetch } from "#infrastructure/upstream-artifact.ts";
import type { RetainableQualificationOutcome } from "./metrics.ts";
import { createRetainableQualifier } from "./qualification-routes.ts";

export function registerArtifactRoutes(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  delivery: Delivery,
  options: {
    repositoryId: number;
    transport?: UpstreamFetch;
    qualifyBuild: (
      input: QualificationRequest,
    ) => Promise<RetainableQualificationOutcome>;
    recordRetainableQualification: (
      outcome: RetainableQualificationOutcome,
    ) => void;
  },
) {
  app.get("/api/v1/artifacts/latest-qualified", async (c) =>
    c.json(
      await delivery.latestQualifiedArtifact(
        LatestQualifiedArtifactQuerySchema.parse(c.req.query()),
        options.repositoryId,
      ),
    ),
  );
  app.get("/api/v1/artifacts/latest-retainable", async (c) =>
    c.json(
      await delivery.latestRetainableArtifact(
        LatestRetainableArtifactQuerySchema.parse(c.req.query()),
        options.repositoryId,
        createRetainableQualifier({
          qualifyInStore: (id, status, actor, reason) =>
            delivery.qualify(id, status, actor, reason),
          qualifyBuild: options.qualifyBuild,
          principal: c.get("principal"),
          requestId: c.get("requestId"),
          recordOutcome: options.recordRetainableQualification,
        }),
      ),
    ),
  );
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
