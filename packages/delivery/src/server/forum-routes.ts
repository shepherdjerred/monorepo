import type { Hono } from "hono";
import { z } from "zod";
import type { Principal } from "#shared/contract.ts";
import {
  CompleteForumBaselineSchema,
  FailForumBaselineSchema,
  PublishForumBundleSchema,
  RequestForumBaselineSchema,
  QualifiedForumBundleQuerySchema,
} from "#shared/forum-contract.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import type { VerifyForumBundle } from "#infrastructure/forum/bundles.ts";
import type { InspectForumBaseline } from "#infrastructure/forum/baseline-settlement.ts";
import { DeliveryError } from "#domain/error.ts";

export function registerForumRoutes(
  app: Hono<{ Variables: { principal: Principal; requestId: string } }>,
  delivery: Delivery,
  options: {
    verifyBundle?: VerifyForumBundle;
    inspectBaseline?: InspectForumBaseline;
  },
) {
  app.get("/api/v1/forum/bundles/qualified", async (c) =>
    c.json(
      await delivery.qualifiedForumBundle(
        QualifiedForumBundleQuerySchema.parse(c.req.query()),
        c.get("principal"),
      ),
    ),
  );
  app.post("/api/v1/deployments/:id/forum-baseline-check", async (c) => {
    z.object({})
      .strict()
      .parse(await c.req.json());
    if (options.inspectBaseline === undefined)
      throw new DeliveryError(
        "PAUSED",
        "Independent authenticated forum runtime inspection is not provisioned",
      );
    return c.json(
      await delivery.verifyForumDeploymentBaseline(
        c.req.param("id"),
        c.get("principal"),
        options.inspectBaseline,
      ),
    );
  });
  app.post("/api/v1/forum/bundles", async (c) =>
    c.json(
      await delivery.publishForumBundle(
        PublishForumBundleSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
      201,
    ),
  );
  app.get("/api/v1/forum/bundles/pending", async (c) =>
    c.json(await delivery.pendingForumBundles(c.get("principal"))),
  );
  app.post("/api/v1/forum/bundles/:id/qualify", async (c) => {
    z.object({})
      .strict()
      .parse(await c.req.json());
    if (options.verifyBundle === undefined)
      throw new DeliveryError(
        "PAUSED",
        "Independent private licensed bundle reader is not provisioned",
      );
    return c.json(
      await delivery.qualifyForumBundle(
        c.req.param("id"),
        c.get("principal"),
        options.verifyBundle,
      ),
    );
  });
  app.post("/api/v1/forum/baselines", async (c) =>
    c.json(
      await delivery.requestForumBaseline(
        RequestForumBaselineSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
      201,
    ),
  );
  app.get("/api/v1/forum/baselines/pending", async (c) =>
    c.json(await delivery.pendingForumBaselines(c.get("principal"))),
  );
  app.get("/api/v1/forum/baselines/:id", async (c) =>
    c.json(await delivery.forumBaseline(c.req.param("id"), c.get("principal"))),
  );
  app.post("/api/v1/forum/baselines/:id/submitted", async (c) => {
    const input = z
      .object({ workflowId: z.string().min(1) })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await delivery.submittedForumBaseline(
        c.req.param("id"),
        input.workflowId,
        c.get("principal"),
      ),
    );
  });
  app.post("/api/v1/forum/baselines/:id/complete", async (c) => {
    if (options.inspectBaseline === undefined)
      throw new DeliveryError(
        "PAUSED",
        "Independent authenticated forum runtime inspection is not provisioned",
      );
    return c.json(
      await delivery.completeForumBaseline(
        c.req.param("id"),
        CompleteForumBaselineSchema.parse(await c.req.json()),
        c.get("principal"),
        options.inspectBaseline,
      ),
    );
  });
  app.post("/api/v1/forum/baselines/:id/fail", async (c) => {
    const input = FailForumBaselineSchema.parse(await c.req.json());
    return c.json(
      await delivery.failForumBaseline(
        c.req.param("id"),
        input.message,
        c.get("principal"),
      ),
    );
  });
}
