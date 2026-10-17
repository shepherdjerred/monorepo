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
  IdentifierSchema,
  LatestQualifiedArtifactQuerySchema,
  PipelineDefinitionSchema,
  PublishBuildSchema,
  RegisterEnvironmentSchema,
  StageInputSchema,
  ImportSnapshotSchema,
} from "#shared/contract.ts";
import type { Principal, PublishBuild } from "#shared/contract.ts";
import { ciIdentity } from "#infrastructure/qualification.ts";
import { RecoveryRequestSchema } from "#infrastructure/recovery.ts";
import type { createRecoveryInspector } from "#infrastructure/recovery.ts";

type Options = {
  delivery: Delivery;
  config: RuntimeConfig;
  peerAddress: (request: Request) => string | null;
  ciOrigin: string;
  ciRepositoryId: number;
  inspectRecovery?: ReturnType<typeof createRecoveryInspector>;
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
  app.use(bodyLimit({ maxSize: 1024 * 1024 }));
  app.use(async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    await next();
  });
  app.get("/healthz", (c) => c.json({ status: "ok" }));
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
    if (c.req.method === "GET") requireScope(principal, "read");
    else if (!(await options.config.writesEnabled())) {
      const resultOnly =
        /\/deployments\/[^/]+\/(?:cancel|finish|release-lock|orphan)$/.test(
          c.req.path,
        ) || /^\/api\/v1\/dispatch\/[^/]+\/submitted$/.test(c.req.path);
      let settlesStage = false;
      if (/\/deployments\/[^/]+\/stages$/.test(c.req.path)) {
        const body: unknown = await c.req.raw.clone().json();
        const stage = StageInputSchema.safeParse(body);
        settlesStage = stage.success && stage.data.status !== "running";
      }
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
  app.post("/api/v1/deployments", async (c) => {
    requireScope(c.get("principal"), "deploy");
    const input = CreateDeploymentSchema.parse(await c.req.json());
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
  app.get("/api/v1/qualification/pending", async (c) => {
    requireScope(c.get("principal"), "execute");
    return c.json(await delivery.pendingQualification());
  });
  app.post("/api/v1/builds/:id/qualify", async (c) => {
    requireScope(c.get("principal"), "execute");
    const build = await delivery.build(c.req.param("id"));
    await delivery.markQualificationAttempt(build.id);
    try {
      const status = await options.qualifyBuild(build);
      return c.json(
        await delivery.qualify(build.id, status, c.get("principal")),
      );
    } catch (error) {
      if (error instanceof DeliveryError && error.code === "INVALID")
        return c.json(
          await delivery.qualify(
            build.id,
            "failed",
            c.get("principal"),
            error.message,
          ),
        );
      throw error;
    }
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
  app.post("/api/v1/deployments/:id/claim", async (c) => {
    requireScope(c.get("principal"), "execute");
    const detail = await delivery.detail(c.req.param("id"));
    await enabled(detail.environment.id);
    return c.json(
      await delivery.claim(detail.deployment.id, c.get("principal")),
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
  app.post("/api/v1/deployments/:id/release-lock", async (c) => {
    requireScope(c.get("principal"), "admin");
    const input = RecoveryRequestSchema.parse(await c.req.json());
    if (options.inspectRecovery === undefined)
      throw new DeliveryError(
        "PAUSED",
        "Independent recovery inspection is unavailable",
      );
    const detail = await delivery.detail(c.req.param("id"));
    const settled = await options.inspectRecovery(detail, input);
    return c.json(
      await delivery.releaseLock(
        detail.deployment.id,
        input.reason,
        c.get("principal"),
        settled,
      ),
    );
  });
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
