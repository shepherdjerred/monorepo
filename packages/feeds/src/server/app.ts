import { serveStatic } from "@hono/bun";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError, z } from "zod";
import {
  CreateUserFeedBodySchema,
  EntryViewSchema,
  MarkAllReadBodySchema,
  UpdateEntriesStateBodySchema,
  UpdateUserFeedBodySchema,
} from "@shepherdjerred/feeds/shared/contract.ts";
import {
  authenticateConsole,
  authenticateMachine,
  parseTrustedProxyBlockList,
  type FeedsAuthConfig,
} from "./auth.ts";
import {
  createGoogleReaderRoutes,
  type CreateGoogleReaderRoutesDeps,
} from "./greader.ts";
import {
  classifyFeedsRoute,
  createFeedsMetrics,
  PROMETHEUS_CONTENT_TYPE,
  type FeedsMetrics,
  type FeedsSurface,
} from "./metrics.ts";
import { redactUrlForDisplay } from "./ssrf.ts";
import type {
  FeedsPoller,
  FeedsRepository,
  StoreMutationFailure,
} from "./types.ts";

export type ReaderCredentialsConfig = {
  readonly readerUser: string;
  readonly readerPassword: string;
  readonly writeTokenSecret: string;
};

export type FeedsReaderAppDependencies = {
  readonly store: FeedsRepository;
  readonly poller: FeedsPoller;
  readonly reader: ReaderCredentialsConfig;
  readonly metrics?: FeedsMetrics | undefined;
  readonly nowSeconds?: (() => number) | undefined;
};

export type FeedsConsoleAppDependencies = {
  readonly store: FeedsRepository;
  readonly poller: FeedsPoller;
  readonly auth: FeedsAuthConfig;
  readonly reader?: ReaderCredentialsConfig | undefined;
  readonly peerAddress?: ((request: Request) => string | null) | undefined;
  readonly clientRoot?: string | undefined;
  readonly metrics?: FeedsMetrics | undefined;
  readonly nowSeconds?: (() => number) | undefined;
};

const EntriesQueryParamsSchema = z.strictObject({
  view: EntryViewSchema.default("unread"),
  category: z.string().min(1).optional(),
  feedId: z.coerce.number().int().positive().optional(),
  q: z.string().optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const FeedIdParamSchema = z.coerce.number().int().positive();

async function parseJsonPayload(request: Request): Promise<unknown> {
  const rawBody = await request.text();
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new HTTPException(400, { message: "request body is not JSON" });
  }
}

function registerFeedsErrorBoundary(app: Hono, surface: FeedsSurface): void {
  app.onError((caught, c) => {
    if (caught instanceof HTTPException) {
      return c.json({ error: caught.message }, caught.status);
    }
    if (caught instanceof ZodError) {
      return c.json({ error: "invalid request" }, 400);
    }
    console.error(
      JSON.stringify({
        level: "error",
        service: "feeds",
        surface,
        method: c.req.method,
        path: c.req.path,
        message: "feeds_unhandled_request_error",
        error: caught instanceof Error ? caught.message : String(caught),
      }),
    );
    return c.json({ error: "internal error" }, 500);
  });
}

function attachRequestMetrics(
  app: Hono,
  metrics: FeedsMetrics,
  surface: FeedsSurface,
  hasClient: boolean,
): void {
  app.use("*", async (c, next) => {
    await next();
    const route = classifyFeedsRoute(
      surface,
      c.req.method,
      c.req.path,
      hasClient,
    );
    metrics.recordRequest(surface, route, c.res.status);
  });
}

function mutationFailureResponse(
  c: { json: (body: unknown, status: 400 | 403 | 404 | 409) => Response },
  failure: StoreMutationFailure,
): Response {
  switch (failure.kind) {
    case "forbidden":
      return c.json({ error: failure.message }, 403);
    case "not-found":
      return c.json({ error: failure.message }, 404);
    case "conflict":
      return c.json({ error: failure.message }, 409);
    case "invalid":
      return c.json({ error: failure.message }, 400);
  }
}

function buildReaderDeps(
  store: FeedsRepository,
  poller: FeedsPoller,
  reader: ReaderCredentialsConfig,
  nowSeconds: (() => number) | undefined,
): CreateGoogleReaderRoutesDeps {
  return {
    store,
    poller,
    readerUser: reader.readerUser,
    readerPassword: reader.readerPassword,
    writeTokenSecret: reader.writeTokenSecret,
    nowSeconds,
  };
}

async function backgroundRefreshFeed(
  poller: FeedsPoller,
  feedId: number,
): Promise<void> {
  try {
    await poller.refreshFeed(feedId);
  } catch {
    // Poll failures are persisted onto the feed row by the poller.
  }
}

/**
 * Isolated public Reader API listener (`feeds.sjer.red` on port 7431).
 * Serves ONLY `/healthz` and `/api/greader.php/*`; console UI, `/api/v1/*`,
 * `/metrics`, and `/internal/*` are unmounted and return 404.
 */
export function createFeedsReaderApp(
  dependencies: FeedsReaderAppDependencies,
): Hono {
  const metrics = dependencies.metrics ?? createFeedsMetrics();
  const app = new Hono();
  registerFeedsErrorBoundary(app, "reader");
  attachRequestMetrics(app, metrics, "reader", false);
  app.get("/healthz", (c) => c.text("ok"));
  app.route(
    "/api/greader.php",
    createGoogleReaderRoutes(
      buildReaderDeps(
        dependencies.store,
        dependencies.poller,
        dependencies.reader,
        dependencies.nowSeconds,
      ),
    ),
  );
  return app;
}

function registerConsoleV1Routes(
  app: Hono,
  store: FeedsRepository,
  poller: FeedsPoller,
  metrics: FeedsMetrics,
): void {
  app.get("/api/v1/summary", (c) => c.json(store.summary()));

  app.get("/api/v1/entries", (c) => {
    const raw = Object.fromEntries(new URL(c.req.url).searchParams.entries());
    const parsed = EntriesQueryParamsSchema.parse(raw);
    return c.json(store.queryEntries(parsed));
  });

  app.post("/api/v1/entries/state", async (c) => {
    const body = UpdateEntriesStateBodySchema.parse(
      await parseJsonPayload(c.req.raw),
    );
    const updated = store.updateEntriesState(body);
    return c.json({ updated });
  });

  app.post("/api/v1/entries/mark-all-read", async (c) => {
    const body = MarkAllReadBodySchema.parse(await parseJsonPayload(c.req.raw));
    const updated = store.markAllRead(body);
    return c.json({ updated });
  });

  app.post("/api/v1/refresh", async (c) => {
    const result = await poller.refreshAll({ force: true });
    metrics.recordPollRun(result);
    return c.json(result);
  });

  app.get("/api/v1/feeds", (c) =>
    c.json(store.listFeedsHealth(redactUrlForDisplay)),
  );

  app.post("/api/v1/feeds", async (c) => {
    const body = CreateUserFeedBodySchema.parse(
      await parseJsonPayload(c.req.raw),
    );
    if (body.title === undefined) {
      const discovered = await poller.discoverAndSubscribe({
        url: body.url,
        category: body.category,
      });
      if (!discovered.ok) return mutationFailureResponse(c, discovered);
      if (
        body.hidden ||
        body.autoRead !== undefined ||
        body.htmlUrl !== undefined
      ) {
        const patched = store.updateUserFeed(discovered.feed.id, {
          hidden: body.hidden,
          ...(body.autoRead === undefined ? {} : { autoRead: body.autoRead }),
          ...(body.htmlUrl === undefined ? {} : { htmlUrl: body.htmlUrl }),
        });
        if (!patched.ok) return mutationFailureResponse(c, patched);
      }
      return c.json({ id: discovered.feed.id }, 201);
    }
    const created = store.createUserFeed(body);
    if (!created.ok) return mutationFailureResponse(c, created);
    void backgroundRefreshFeed(poller, created.feed.id);
    return c.json({ id: created.feed.id }, 201);
  });

  app.patch("/api/v1/feeds/:id", async (c) => {
    const id = FeedIdParamSchema.parse(c.req.param("id"));
    const body = UpdateUserFeedBodySchema.parse(
      await parseJsonPayload(c.req.raw),
    );
    const updated = store.updateUserFeed(id, body);
    return updated.ok
      ? c.json({ id: updated.feed.id })
      : mutationFailureResponse(c, updated);
  });

  app.delete("/api/v1/feeds/:id", (c) => {
    const id = FeedIdParamSchema.parse(c.req.param("id"));
    const deleted = store.deleteUserFeed(id);
    return deleted.ok
      ? c.json({ deleted: true })
      : mutationFailureResponse(c, deleted);
  });
}

function isNonClientConsolePath(pathname: string): boolean {
  return (
    pathname === "/healthz" ||
    pathname === "/metrics" ||
    pathname === "/internal/refresh" ||
    pathname === "/api" ||
    pathname.startsWith("/api/")
  );
}

function serveAuthenticatedClient(
  app: Hono,
  clientRoot: string,
  auth: FeedsAuthConfig,
  peerAddress: ((request: Request) => string | null) | undefined,
): void {
  app.use("*", async (c, next) => {
    if (isNonClientConsolePath(c.req.path)) {
      return next();
    }
    const principal = await authenticateConsole(
      c.req.raw,
      peerAddress?.(c.req.raw) ?? null,
      auth,
    );
    return "status" in principal
      ? c.json({ error: principal.error }, principal.status)
      : next();
  });

  const hashedAssetsMiddleware = serveStatic({
    root: clientRoot,
    onFound: (_assetPath, c) => {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
    },
  });
  const spaShellMiddleware = serveStatic({
    root: clientRoot,
    path: "index.html",
    onFound: (_docPath, c) => {
      c.header("Cache-Control", "no-cache");
    },
  });

  app.use("/assets/*", hashedAssetsMiddleware);
  app.all("/assets/*", (c) => c.notFound());
  app.get("*", spaShellMiddleware);
}

export function createFeedsConsoleApp(
  dependencies: FeedsConsoleAppDependencies,
): Hono {
  if (typeof dependencies.auth.trustedProxyAddresses !== "function") {
    parseTrustedProxyBlockList(dependencies.auth.trustedProxyAddresses);
  }
  const { store, poller, auth, clientRoot } = dependencies;
  const metrics = dependencies.metrics ?? createFeedsMetrics();
  const app = new Hono();

  registerFeedsErrorBoundary(app, "console");
  attachRequestMetrics(app, metrics, "console", clientRoot !== undefined);

  app.get("/healthz", (c) => c.text("ok"));
  app.get("/metrics", (c) =>
    c.body(metrics.render(store), 200, {
      "Content-Type": PROMETHEUS_CONTENT_TYPE,
      "Cache-Control": "no-store",
    }),
  );

  app.post("/internal/refresh", async (c) => {
    const principal = authenticateMachine(c.req.raw, auth);
    if ("status" in principal) {
      return c.json({ error: principal.error }, principal.status);
    }
    const result = await poller.refreshAll();
    metrics.recordPollRun(result);
    return c.json(result);
  });

  if (dependencies.reader !== undefined) {
    app.route(
      "/api/greader.php",
      createGoogleReaderRoutes(
        buildReaderDeps(
          store,
          poller,
          dependencies.reader,
          dependencies.nowSeconds,
        ),
      ),
    );
  }

  app.use("/api/v1/*", async (c, next) => {
    const principal = await authenticateConsole(
      c.req.raw,
      dependencies.peerAddress?.(c.req.raw) ?? null,
      auth,
    );
    return "status" in principal
      ? c.json({ error: principal.error }, principal.status)
      : next();
  });

  registerConsoleV1Routes(app, store, poller, metrics);

  if (clientRoot !== undefined) {
    serveAuthenticatedClient(app, clientRoot, auth, dependencies.peerAddress);
  }

  return app;
}
