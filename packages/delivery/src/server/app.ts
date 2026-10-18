import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import { authenticate, requireScope } from "#infrastructure/auth.ts";
import { RetrySchema } from "#infrastructure/delivery.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import type { RuntimeConfig } from "#infrastructure/config.ts";
import {
  ApprovalInputSchema,
  ComposeVersionSetSchema,
  CreateDeploymentSchema,
  FinishDeploymentSchema,
  LatestQualifiedArtifactQuerySchema,
  PublishBuildSchema,
  StageInputSchema,
  ImportSnapshotSchema,
} from "#shared/contract.ts";
import type { Principal, PublishBuild } from "#shared/contract.ts";
import { ciIdentity } from "#infrastructure/qualification.ts";
import type { createRecoveryInspector } from "#infrastructure/recovery.ts";
import { registerWorkerRoutes } from "./worker-routes.ts";
import { registerPlatformRoutes } from "./platform-routes.ts";
import { registerPlatformRecoveryRoutes } from "./platform-recovery-routes.ts";
import { registerContentRecoveryRoutes } from "./content-recovery-routes.ts";
import { registerClaimRoute } from "./claim-route.ts";
import { registerTrmnlRepairRoute } from "./trmnl-repair-route.ts";
import { registerControlPlaneRoutes } from "./control-plane-routes.ts";
import { registerForumRoutes } from "./forum-routes.ts";
import { registerDefinitionRoutes } from "./registration-routes.ts";
import type { VerifyForumBundle } from "#infrastructure/forum/bundles.ts";
import type { InspectForumBaseline } from "#infrastructure/forum/baseline-settlement.ts";
import { settlesExistingStage } from "./stage-settlement.ts";
import { registerWorkerRecoveryRoutes } from "./worker-recovery-routes.ts";
import { registerMinecraftRecoveryRoutes } from "./minecraft-recovery-routes.ts";
import type { InspectMinecraftRecovery } from "#infrastructure/minecraft-recovery/inspector.ts";
import { deliveryMetrics } from "./metrics.ts";
import { registerArtifactRoutes } from "./artifact-routes.ts";
import { registerQualificationRoutes } from "./qualification-routes.ts";
import type { UpstreamFetch } from "#infrastructure/upstream-artifact.ts";
import { registerOwnershipRoute } from "./ownership-route.ts";
import { registerRecoveryRoute } from "./recovery-route.ts";

type Options = {
  sourceRevision?: string;
  delivery: Delivery;
  config: RuntimeConfig;
  peerAddress: (request: Request) => string | null;
  ciOrigin: string;
  ciRepositoryId: number;
  inspectRecovery?: ReturnType<typeof createRecoveryInspector>;
  inspectMinecraftRecovery?: InspectMinecraftRecovery;
  verifyForumBundle?: VerifyForumBundle;
  inspectForumBaseline?: InspectForumBaseline;
  upstreamFetch?: UpstreamFetch;
  qualifyBuild: (
    input: Pick<PublishBuild, "ciUrl" | "sourceRevision">,
  ) => Promise<"pending" | "verified" | "failed">;
};
export function createApp(options: Options) {
  const app = new Hono<{
    Variables: { principal: Principal; requestId: string };
  }>();
  const clientRoot = `${import.meta.dir}/../../dist/client`;
  app.use(secureHeaders());
  app.use((c, next) =>
    bodyLimit({
      onError: () =>
        c.json(
          {
            error: {
              code: "INVALID",
              message: "Request exceeds its bounded payload size",
              requestId: crypto.randomUUID(),
            },
          },
          413,
        ),
      maxSize:
        c.req.path === "/api/v1/platform/plans" ||
        /^\/api\/v1\/platform-recovery\/[^/]+\/plan$/.test(c.req.path)
          ? 16 * 1024 * 1024
          : 1024 * 1024,
    })(c, next),
  );
  app.use(async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    await next();
  });
  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/metrics", async (c) => {
    c.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return c.body(await deliveryMetrics(options.delivery.database));
  });
  app.get("/readyz", async (c) => {
    try {
      await options.delivery.database.$queryRaw`SELECT 1`;
      return c.json({ status: "ok" });
    } catch {
      return c.json({ status: "unavailable" }, 503);
    }
  });
  app.use("/api/*", async (c, next) => {
    const principal = await authenticate(
      c.req.raw,
      options.peerAddress(c.req.raw),
      options.config,
    );
    c.set("principal", principal);
    if (c.req.method === "GET") {
      if (c.req.path !== "/api/v1/forum/bundles/qualified")
        requireScope(principal, "read");
    } else if (!(await options.config.writesEnabled())) {
      const resultOnly =
        /\/deployments\/[^/]+\/(?:cancel|finish|release-lock|orphan)$/.test(
          c.req.path,
        ) ||
        /^\/api\/v1\/dispatch\/[^/]+\/submitted$/.test(c.req.path) ||
        /\/worker-recovery(?:\/|$)/.test(c.req.path) ||
        /\/minecraft-recovery(?:\/|$)/.test(c.req.path) ||
        (/\/content-recovery(?:\/|$)/.test(c.req.path) &&
          !c.req.path.endsWith("/admit-repair")) ||
        (/\/platform-recovery(?:\/|$)/.test(c.req.path) &&
          !c.req.path.endsWith("/admit-apply")) ||
        /^\/api\/v1\/forum\/baselines\/[^/]+\/(?:submitted|complete|fail)$/.test(
          c.req.path,
        ) ||
        /^\/api\/v1\/platform\/plans$/.test(c.req.path);
      const settlesStage = await settlesExistingStage(
        options.delivery,
        c.req.raw,
      );
      if (!resultOnly && !settlesStage)
        throw new DeliveryError("PAUSED", "Delivery mutations are paused");
    }
    await next();
  });
  async function enabled(environmentId: string) {
    const environments = await options.config.enabledEnvironments();
    if (!environments.includes(environmentId))
      throw new DeliveryError(
        "PAUSED",
        "Delivery execution is disabled for this environment",
      );
  }
  const delivery = options.delivery;
  registerOwnershipRoute(app, options);
  registerPlatformRecoveryRoutes(app, delivery, enabled);
  registerContentRecoveryRoutes(app, delivery, enabled);
  registerWorkerRecoveryRoutes(app, delivery);
  registerMinecraftRecoveryRoutes(
    app,
    delivery,
    options.inspectMinecraftRecovery,
  );
  registerQualificationRoutes(app, delivery, options.qualifyBuild);
  registerArtifactRoutes(app, delivery, {
    repositoryId: options.ciRepositoryId,
    ...(options.upstreamFetch === undefined
      ? {}
      : { transport: options.upstreamFetch }),
  });
  app.get("/api/v1/identity", (c) => c.json(c.get("principal")));
  app.get("/api/v1/imports", async (c) =>
    c.json(await delivery.importedSnapshots()),
  );
  app.post("/api/v1/imports", async (c) => {
    requireScope(c.get("principal"), "admin");
    return c.json(
      await delivery.importSnapshot(
        ImportSnapshotSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
      201,
    );
  });
  app.get("/api/v1/overview", async (c) => c.json(await delivery.overview()));
  app.get("/api/v1/artifacts/latest-qualified", async (c) =>
    c.json(
      await delivery.latestQualifiedArtifact(
        LatestQualifiedArtifactQuerySchema.parse(c.req.query()),
        options.ciRepositoryId,
      ),
    ),
  );
  app.get("/api/v1/versions", async (c) =>
    c.json(await delivery.versions(c.req.query("serviceId"))),
  );
  app.get("/api/v1/versions/:id", async (c) =>
    c.json(await delivery.version(c.req.param("id"))),
  );
  app.get("/api/v1/deployments/:id", async (c) =>
    c.json(await delivery.detail(c.req.param("id"))),
  );
  app.post("/api/v1/builds", async (c) => {
    requireScope(c.get("principal"), "publish");
    const input = PublishBuildSchema.parse(await c.req.json());
    return c.json(
      await delivery.publish(
        input,
        c.get("principal"),
        ciIdentity(input.ciUrl, options.ciOrigin, options.ciRepositoryId),
      ),
      201,
    );
  });
  app.post("/api/v1/versions", async (c) => {
    requireScope(c.get("principal"), "publish");
    return c.json(
      await delivery.compose(
        ComposeVersionSetSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
      201,
    );
  });
  registerDefinitionRoutes(app, delivery);
  registerWorkerRoutes(app, { delivery, enabled });
  registerPlatformRoutes(app, { delivery, enabled });
  registerClaimRoute(app, delivery, enabled);
  registerTrmnlRepairRoute(app, delivery, enabled);
  registerControlPlaneRoutes(app, delivery, enabled);
  registerForumRoutes(app, delivery, {
    ...(options.verifyForumBundle === undefined
      ? {}
      : { verifyBundle: options.verifyForumBundle }),
    ...(options.inspectForumBaseline === undefined
      ? {}
      : { inspectBaseline: options.inspectForumBaseline }),
  });
  app.post("/api/v1/deployments", async (c) => {
    const input = await authorizedDeploymentInput(c.get("principal"), () =>
      c.req.json(),
    );
    await enabled(input.environmentId);
    return c.json(
      await delivery.createDeployment(input, c.get("principal")),
      201,
    );
  });
  app.post("/api/v1/deployments/:id/approval", async (c) => {
    requireScope(c.get("principal"), "approve");
    const input = ApprovalInputSchema.parse(await c.req.json());
    const detail = await delivery.detail(c.req.param("id"));
    await enabled(detail.environment.id);
    return c.json(
      await delivery.approve(
        detail.deployment.id,
        input.decision,
        input.reason,
        c.get("principal"),
      ),
    );
  });
  app.post("/api/v1/deployments/:id/cancel", async (c) => {
    requireScope(c.get("principal"), "deploy");
    return c.json(await delivery.cancel(c.req.param("id"), c.get("principal")));
  });
  app.post("/api/v1/deployments/:id/retry", async (c) => {
    requireScope(c.get("principal"), "deploy");
    const input = RetrySchema.parse(await c.req.json());
    const detail = await delivery.detail(c.req.param("id"));
    await enabled(detail.environment.id);
    if (!["failed", "canceled"].includes(detail.deployment.status))
      throw new DeliveryError(
        "CONFLICT",
        "Only failed or canceled deployments can be retried",
      );
    if (
      detail.deployment.kind !== "deploy" &&
      detail.deployment.kind !== "promote" &&
      detail.deployment.kind !== "rollback"
    )
      throw new DeliveryError(
        "INVALID",
        "Request a new specialized deployment with exact fresh inputs",
      );
    return c.json(
      await delivery.createDeployment(
        {
          ...input,
          environmentId: detail.environment.id,
          versionSetRevisionId: detail.versionSet.id,
          kind: detail.deployment.kind,
          ...(detail.deployment.sourceEnvironmentId === null
            ? {}
            : { sourceEnvironmentId: detail.deployment.sourceEnvironmentId }),
        },
        c.get("principal"),
      ),
      201,
    );
  });
  app.get("/api/v1/dispatch/pending", async (c) => {
    requireScope(c.get("principal"), "execute");
    if (!(await options.config.writesEnabled()))
      return c.json({ deployments: [] });
    const allowed = await options.config.enabledEnvironments();
    const pending = await delivery.pending();
    return c.json({
      deployments: pending.deployments.filter((entry) =>
        allowed.includes(entry.environmentId),
      ),
    });
  });
  app.get("/api/v1/dispatch/monitor", async (c) => {
    requireScope(c.get("principal"), "execute");
    return c.json(await delivery.monitor());
  });
  app.post("/api/v1/deployments/:id/orphan", async (c) => {
    requireScope(c.get("principal"), "execute");
    const input = z
      .object({
        workflowId: z.string().min(1),
        reason: z.string().min(1).max(4000),
        workflowStatus: z.enum([
          "COMPLETED",
          "FAILED",
          "CANCELED",
          "TERMINATED",
          "TIMED_OUT",
        ]),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await delivery.orphan(c.req.param("id"), input, c.get("principal")),
    );
  });
  app.post("/api/v1/reconcile", async (c) => {
    requireScope(c.get("principal"), "execute");
    return c.json(
      await delivery.reconcile(
        await options.config.enabledEnvironments(),
        c.get("principal"),
      ),
    );
  });
  app.post("/api/v1/dispatch/:id/submitted", async (c) => {
    requireScope(c.get("principal"), "execute");
    const input = z
      .object({ workflowId: z.string().min(1) })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await delivery.submitted(c.req.param("id"), input.workflowId),
    );
  });
  app.post("/api/v1/deployments/:id/stages", async (c) => {
    requireScope(c.get("principal"), "execute");
    const input = StageInputSchema.parse(await c.req.json());
    if (input.status === "running") {
      const detail = await delivery.detail(c.req.param("id"));
      await enabled(detail.environment.id);
    }
    return c.json(
      await delivery.stage(c.req.param("id"), input, c.get("principal")),
    );
  });
  app.post("/api/v1/deployments/:id/finish", async (c) => {
    requireScope(c.get("principal"), "execute");
    return c.json(
      await delivery.finish(
        c.req.param("id"),
        FinishDeploymentSchema.parse(await c.req.json()),
        c.get("principal"),
      ),
    );
  });
  registerRecoveryRoute(app, delivery, options.inspectRecovery);
  app.all("/api/*", (c) =>
    c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Unknown API route",
          requestId: c.get("requestId"),
        },
      },
      404,
    ),
  );
  app.use("/assets/*", serveStatic({ root: clientRoot }));
  app.get("*", serveStatic({ root: clientRoot, path: "index.html" }));
  app.onError((error, c) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return c.json(
        {
          error: {
            code: "INVALID",
            message: "Invalid request",
            requestId: c.get("requestId"),
          },
        },
        400,
      );
    if (error instanceof DeliveryError) {
      const statuses = {
        NOT_FOUND: 404,
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        PAUSED: 503,
        CONFLICT: 409,
        BUSY: 409,
        INVALID: 400,
      } as const;
      return c.json(
        {
          error: {
            code: error.code,
            message: error.message,
            requestId: c.get("requestId"),
          },
        },
        statuses[error.code],
      );
    }
    console.error(
      JSON.stringify({
        message: "delivery_request_failed",
        requestId: c.get("requestId"),
        errorType: error.name,
      }),
    );
    return c.json(
      {
        error: {
          code: "INTERNAL",
          message: "Delivery request failed",
          requestId: c.get("requestId"),
        },
      },
      500,
    );
  });
  return app;
}

async function authorizedDeploymentInput(
  principal: Principal,
  read: () => Promise<unknown>,
) {
  if (!principal.scopes.includes("admin")) requireScope(principal, "deploy");
  const input = CreateDeploymentSchema.parse(await read());
  requireScope(principal, input.kind === "adopt-worker" ? "admin" : "deploy");
  return input;
}
