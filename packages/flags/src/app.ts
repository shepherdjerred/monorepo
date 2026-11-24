import { Hono } from "hono";
import { serveStatic } from "@hono/bun";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { flagDeployments } from "@shepherdjerred/feature-flags/deployments.ts";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import { diffProjectedDeploymentFlags } from "@shepherdjerred/feature-flags/flags-drift.ts";
import {
  authenticate,
  parseTrustedProxyBlockList,
  type FlagsAuthConfig,
} from "./auth.ts";
import {
  ApplyBodySchema,
  CreateMissingBodySchema,
  EvaluateBodySchema,
  RetireBodySchema,
} from "./schema.ts";
import {
  classifyFlagsRoute,
  createFlagsMetrics,
  PROMETHEUS_CONTENT_TYPE,
  type FlagsMetrics,
  type FlagsSurface,
} from "./metrics.ts";
import type { FlagStore } from "./store.ts";

const SNAPSHOT = /^\/v1\/deployments\/[^/]+\/[^/]+\/snapshot$/u;
const CREDENTIALLESS_REJECTION = {
  error: "evaluation does not accept credentials",
} as const;

export type FlagsEvaluationAppDependencies = {
  readonly store: FlagStore;
  readonly metrics?: FlagsMetrics;
};

export type FlagsAppDependencies = {
  readonly store: FlagStore;
  readonly auth: FlagsAuthConfig;
  readonly peerAddress?: (request: Request) => string | null;
  /** Built operator client. Absent in tests and before `vite build`. */
  readonly clientRoot?: string;
  readonly metrics?: FlagsMetrics;
};

function deploymentId(catalog: string, stage: string): string {
  return `${catalog}/${stage}`;
}

function etag(revision: number): string {
  return `"${String(revision)}"`;
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HTTPException(400, { message: "request body is not JSON" });
  }
}

function attachErrorHandler(app: Hono): void {
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: error.message }, error.status);
    }
    if (error instanceof ZodError) {
      return c.json({ error: "invalid request" }, 400);
    }
    console.error(
      JSON.stringify({
        level: "error",
        message: "flags request failed",
        service: "flags",
        error: error instanceof Error ? error.message : "unknown error",
      }),
    );
    return c.json({ error: "internal error" }, 500);
  });
}

function registerEvaluationRoutes(app: Hono, store: FlagStore): void {
  app.get("/v1/deployments/:catalog/:stage/snapshot", (c) => {
    const id = deploymentId(c.req.param("catalog"), c.req.param("stage"));
    const document = store.document(id);
    if (document === undefined)
      return c.json({ error: "unknown deployment" }, 404);
    const tag = etag(document.revision);
    c.header("ETag", tag);
    if (c.req.header("if-none-match") === tag) return c.body(null, 304);
    return c.json({
      deployment: document.id,
      revision: document.revision,
      flags: document.flags,
    });
  });

  app.post("/v1/evaluate", async (c) => {
    const body = EvaluateBodySchema.parse(await readBody(c.req.raw));
    const evaluated = store.evaluate(
      body.deployment,
      body.key,
      body.context ?? {},
    );
    if (evaluated.kind === "unknown-deployment") {
      return c.json({ error: "unknown deployment" }, 404);
    }
    if (evaluated.kind === "missing") {
      return c.json({ error: "FLAG_NOT_FOUND" }, 404);
    }
    return evaluated.kind === "type-mismatch" || evaluated.kind === "invalid"
      ? c.json({ error: evaluated.message }, 400)
      : c.json({ enabled: evaluated.value });
  });
}

function attachRequestMetrics(
  app: Hono,
  metrics: FlagsMetrics,
  surface: FlagsSurface,
  hasClient: boolean,
): void {
  app.use("*", async (c, next) => {
    await next();
    const route = classifyFlagsRoute(
      surface,
      c.req.method,
      c.req.path,
      hasClient,
    );
    metrics.recordRequest(surface, route, c.res.status);
  });
}

/**
 * Credentialless evaluation surface for the dedicated in-cluster port. Serves
 * health, snapshots, and boolean evaluation only; management routes, static UI
 * assets, and operator headers are not mounted here.
 */
export function createFlagsEvaluationApp({
  store,
  metrics = createFlagsMetrics(),
}: FlagsEvaluationAppDependencies) {
  const app = new Hono();
  attachErrorHandler(app);
  attachRequestMetrics(app, metrics, "evaluation", false);
  app.get("/healthz", (c) => c.text("ok"));
  app.use("/v1/*", async (c, next) =>
    c.req.header("authorization") === undefined
      ? next()
      : c.json(CREDENTIALLESS_REJECTION, 401),
  );
  registerEvaluationRoutes(app, store);
  return app;
}

export function createFlagsApp(dependencies: FlagsAppDependencies) {
  if (typeof dependencies.auth.trustedProxyAddresses !== "function") {
    parseTrustedProxyBlockList(dependencies.auth.trustedProxyAddresses);
  }
  const { store } = dependencies;
  const metrics = dependencies.metrics ?? createFlagsMetrics();
  const clientRoot = dependencies.clientRoot;
  const app = new Hono();

  attachErrorHandler(app);
  attachRequestMetrics(app, metrics, "management", clientRoot !== undefined);

  app.get("/healthz", (c) => c.text("ok"));
  app.get("/metrics", (c) =>
    c.body(metrics.render(store), 200, {
      "Content-Type": PROMETHEUS_CONTENT_TYPE,
      "Cache-Control": "no-store",
    }),
  );

  app.use("/v1/*", async (c, next) => {
    const path = c.req.path;
    const credentialless =
      (c.req.method === "POST" && path === "/v1/evaluate") ||
      (c.req.method === "GET" && SNAPSHOT.test(path));
    if (credentialless) {
      return c.req.header("authorization") === undefined
        ? next()
        : c.json(CREDENTIALLESS_REJECTION, 401);
    }
    const principal = await authenticate(
      c.req.raw,
      dependencies.peerAddress?.(c.req.raw) ?? null,
      dependencies.auth,
    );
    return "status" in principal
      ? c.json({ error: principal.error }, principal.status)
      : next();
  });

  app.get("/v1/deployments", (c) => c.json({ deployments: store.list() }));

  app.get("/v1/diff", (c) => {
    const deployments = flagDeployments.map((deployment) => {
      const document = store.document(deployment.id);
      if (document === undefined) {
        throw new Error(`seeded deployment ${deployment.id} is missing`);
      }
      return diffProjectedDeploymentFlags(deployment, document);
    });
    return c.json({ deployments });
  });

  app.get("/v1/deployments/:catalog/:stage", (c) => {
    const id = deploymentId(c.req.param("catalog"), c.req.param("stage"));
    const document = store.document(id);
    return document === undefined
      ? c.json({ error: "unknown deployment" }, 404)
      : c.json(document);
  });

  registerEvaluationRoutes(app, store);

  app.get("/v1/deployments/:catalog/:stage/flags/:key", (c) => {
    const id = deploymentId(c.req.param("catalog"), c.req.param("stage"));
    const found = store.flag(id, c.req.param("key"));
    if (found === undefined) {
      return c.json(
        store.document(id) === undefined
          ? { error: "unknown deployment" }
          : { error: "FLAG_NOT_FOUND" },
        404,
      );
    }
    return c.json(found);
  });

  app.post("/v1/deployments/:catalog/:stage/apply", async (c) => {
    const id = deploymentId(c.req.param("catalog"), c.req.param("stage"));
    const body = ApplyBodySchema.parse(await readBody(c.req.raw));
    const result = store.apply(id, body.expectedRevision, body.flags);
    return result.ok
      ? c.json({ revision: result.revision })
      : writeFailure(c, result.failure);
  });

  app.post("/v1/deployments/:catalog/:stage/create-missing", async (c) => {
    const id = deploymentId(c.req.param("catalog"), c.req.param("stage"));
    const body = CreateMissingBodySchema.parse(await readBody(c.req.raw));
    const result = store.createMissing(id, body.flags);
    return result.ok
      ? c.json({ revision: result.revision, created: result.created })
      : writeFailure(c, result.failure);
  });

  app.post("/v1/deployments/:catalog/:stage/retire", async (c) => {
    const id = deploymentId(c.req.param("catalog"), c.req.param("stage"));
    const body = RetireBodySchema.parse(await readBody(c.req.raw));
    const result = store.retire(id, body.expectedRevision, body.keys);
    if (!result.ok) {
      return result.failure.kind === "missing"
        ? c.json({ error: "retire refused", missing: result.failure.keys }, 409)
        : writeFailure(c, result.failure);
    }
    return c.json({ revision: result.revision });
  });

  if (clientRoot !== undefined) serveClient(app, clientRoot);

  return app;
}

function serveClient(app: Hono, clientRoot: string): void {
  app.use(
    "/assets/*",
    serveStatic({
      root: clientRoot,
      onFound(_path, context) {
        context.header("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );
  app.all("/assets/*", (c) => c.notFound());
  app.get(
    "*",
    serveStatic({
      root: clientRoot,
      path: "index.html",
      onFound(_path, context) {
        context.header("Cache-Control", "no-cache");
      },
    }),
  );
}

function writeFailure(
  c: { json: (body: unknown, status?: number) => Response },
  failure:
    | {
        kind: "conflict";
        document: { revision: number; flags: readonly FlagValue[] };
      }
    | { kind: "unknown-deployment" }
    | { kind: "duplicate-key"; key: string },
): Response {
  if (failure.kind === "conflict") {
    return c.json(
      {
        error: "revision conflict",
        revision: failure.document.revision,
        flags: failure.document.flags,
      },
      409,
    );
  }
  return failure.kind === "duplicate-key"
    ? c.json({ error: `duplicate flag key: ${failure.key}` }, 400)
    : c.json({ error: "unknown deployment" }, 404);
}
