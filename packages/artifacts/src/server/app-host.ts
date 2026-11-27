import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { ArtifactsError, STATUS } from "#application/errors.ts";
import {
  humanActor,
  parseActorHeader,
  upsertActor,
} from "#application/actors.ts";
import type { Services } from "#application/services.ts";
import type { ChangeHub } from "#infrastructure/change-hub.ts";
import { reportError } from "#infrastructure/log.ts";
import type { Metrics } from "#infrastructure/metrics.ts";
import type { ObjectStore } from "#infrastructure/object-store.ts";
import { appHeaders } from "#domain/csp.ts";
import { checkCsrf, isBrowserRequest } from "#domain/csrf.ts";
import {
  GuideReferenceSchema,
  guideIndex,
  renderGuide,
} from "./agent-guide.ts";
import { operatorLogin } from "./auth.ts";
import { appRouter } from "./router.ts";
import type { HostClass } from "./rpc.ts";
import { serveClient } from "./client-files.ts";
import { registerStreamRoutes, type StreamStats } from "./streams.ts";
import { registerUploadRoutes, type AppVariables } from "./uploads-route.ts";

export type AppHostOptions = {
  services: Services;
  store: ObjectStore;
  hub: ChangeHub;
  stats: StreamStats;
  metrics: Metrics;
  origins: { app: string };
  operatorLogins: () => Promise<string[]>;
  /** The built browser client; defaults to this package's `dist/client`. */
  clientRoot?: string;
  heartbeatMs?: number;
};

const TRPC_BODY_LIMIT = 1024 * 1024;

function routeName(path: string): string {
  if (path.startsWith("/trpc")) return "trpc";
  if (path.startsWith("/api/uploads")) return "upload";
  if (path.startsWith("/api/feedback")) return "feedback_stream";
  if (path.startsWith("/api/events")) return "events_stream";
  if (path.startsWith("/agent")) return "agent";
  return path.startsWith("/_t") || path.startsWith("/_p") ? "blocked" : "ui";
}

/**
 * The app host: the UI, `/trpc`, `/api` and `/agent`. It never streams object
 * bytes, sends no CORS headers, and answers `/_t/*` and `/_p/*` with 404.
 * Identity is the verified Tailscale login; browsers are protected from
 * cross-site requests by the CSRF rules in `domain/csrf.ts`.
 */
export function createAppHandler(options: AppHostOptions) {
  const { services } = options;
  const app = new Hono<{ Variables: AppVariables }>();

  app.use(async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    await next();
    for (const [name, value] of Object.entries(appHeaders()))
      c.res.headers.set(name, value);
    c.res.headers.set("X-Request-Id", c.get("requestId"));
    options.metrics.requests({
      host: "app",
      route: routeName(c.req.path),
      status: c.res.status,
    });
  });

  // Login gate, then CSRF. Both run before any route, so a rejected request
  // reaches no handler and touches no data.
  app.use(async (c, next) => {
    const login = operatorLogin(c.req.raw.headers);
    const allowed = await options.operatorLogins();
    if (login === null || !allowed.includes(login)) {
      options.metrics.csrfRejection("login");
      return c.json({ error: "Forbidden" }, 403);
    }
    const headers = c.req.raw.headers;
    const rejection = checkCsrf({
      method: c.req.method,
      appOrigin: options.origins.app,
      origin: headers.get("Origin"),
      fetchSite: headers.get("Sec-Fetch-Site"),
      fetchMode: headers.get("Sec-Fetch-Mode"),
      fetchDest: headers.get("Sec-Fetch-Dest"),
    });
    if (rejection !== null) {
      options.metrics.csrfRejection(rejection);
      return c.json({ error: "Cross-site request rejected" }, 403);
    }
    return next();
  });

  // Content never comes from the app origin.
  app.all("/_t", (c) => c.json({ error: "Not found" }, 404));
  app.all("/_t/*", (c) => c.json({ error: "Not found" }, 404));
  app.all("/_p", (c) => c.json({ error: "Not found" }, 404));
  app.all("/_p/*", (c) => c.json({ error: "Not found" }, 404));

  async function limits() {
    const { settings } = services.deps;
    const [
      maxFileBytes,
      maxVersionBytes,
      maxFiles,
      feedbackSettleSeconds,
      boardIdleDays,
      archiveGraceDays,
    ] = await Promise.all([
      settings.value("maxFileBytes"),
      settings.value("maxVersionBytes"),
      settings.value("maxFiles"),
      settings.value("feedbackSettleSeconds"),
      settings.value("boardIdleDays"),
      settings.value("archiveGraceDays"),
    ]);
    return {
      maxFileBytes,
      maxVersionBytes,
      maxFiles,
      feedbackSettleSeconds,
      boardIdleDays,
      archiveGraceDays,
    };
  }

  app.get("/agent/index.json", async (c) => c.json(guideIndex(await limits())));
  app.get("/agent/SKILL.md", async (c) =>
    c.text(renderGuide(await limits()).SKILL, 200, {
      "Content-Type": "text/markdown; charset=utf-8",
    }),
  );
  app.get("/agent/reference/:file", async (c) => {
    const file = c.req.param("file");
    const reference = GuideReferenceSchema.safeParse(
      file.replace(/\.md$/u, ""),
    );
    if (!reference.success || !file.endsWith(".md"))
      return c.json({ error: "Not found" }, 404);
    return c.text(renderGuide(await limits())[reference.data], 200, {
      "Content-Type": "text/markdown; charset=utf-8",
    });
  });
  app.all("/agent/*", (c) => c.json({ error: "Not found" }, 404));

  // Everything below acts as someone: a browser as the human operator, any
  // other caller as the agent it names.
  const resolveCaller = createMiddleware<{ Variables: AppVariables }>(
    async (c, next) => {
      const headers = c.req.raw.headers;
      const actor = isBrowserRequest(headers.get("Sec-Fetch-Site"))
        ? humanActor(operatorLogin(headers) ?? "")
        : parseActorHeader(headers.get("X-Artifacts-Actor"));
      c.set("caller", await upsertActor(services.deps.db, actor));
      await next();
    },
  );
  // JSON procedures never need a large body; blobs have their own route.
  app.use("/trpc/*", bodyLimit({ maxSize: TRPC_BODY_LIMIT }));
  app.use("/trpc/*", resolveCaller);
  app.use("/api/*", resolveCaller);

  const hostClass: HostClass = "app";
  app.all("/trpc/*", async (c) => {
    if (c.req.path.startsWith("/trpc/maintenance."))
      return c.json({ error: "Not found" }, 404);
    return fetchRequestHandler({
      endpoint: "/trpc",
      req: c.req.raw,
      router: appRouter,
      onError: ({ error }) => {
        if (error.code === "INTERNAL_SERVER_ERROR")
          reportError(error.cause ?? error);
      },
      createContext: () => ({
        requestId: c.get("requestId"),
        hostClass,
        caller: c.get("caller"),
        services,
      }),
    });
  });

  registerUploadRoutes(app, { services, store: options.store });
  registerStreamRoutes(app, {
    services,
    hub: options.hub,
    stats: options.stats,
    ...(options.heartbeatMs === undefined
      ? {}
      : { heartbeatMs: options.heartbeatMs }),
  });
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  app.get("*", (c) => serveClient(c.req.path, options.clientRoot));

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    if (error instanceof z.ZodError)
      return c.json(
        { error: "Invalid request", details: z.treeifyError(error) },
        400,
      );
    if (error instanceof ArtifactsError)
      return c.json(
        { error: error.message, ...error.data },
        STATUS[error.code],
      );
    reportError(error);
    return c.json({ error: "Internal server error" }, 500);
  });

  return (request: Request) => app.fetch(request);
}
