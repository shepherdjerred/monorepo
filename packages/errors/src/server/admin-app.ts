import path from "node:path";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { IngestRateLimiter } from "#domain/rate-limit.ts";
import { parsePositiveIntId } from "#infrastructure/repository-helpers.ts";
import type { ErrorsRepository } from "#infrastructure/repository-types.ts";
import {
  createErrorsMetrics,
  traceRequest,
  type ErrorsMetrics,
} from "#infrastructure/telemetry.ts";
import {
  registerAdminApiRoutes,
  type AdminApiRouteDeps,
} from "#server/admin-routes.ts";
import {
  handleEnvelopeOptions,
  handleEnvelopePost,
  resolveIngestRuntime,
} from "#server/ingest-app.ts";

export type AdminAppDeps = AdminApiRouteDeps & {
  readonly ingestEnabled?: (() => Promise<boolean>) | undefined;
  readonly rateLimiter?: IngestRateLimiter | undefined;
  readonly metrics?: ErrorsMetrics | undefined;
  readonly onOutboxQueued?: (() => void) | undefined;
  readonly clientRoot?: string | undefined;
};

const DEFAULT_CLIENT_ROOT = path.resolve(import.meta.dir, "../../dist/client");
const ROOT_PUBLIC_FILES = new Set(["favicon.ico", "favicon.svg", "robots.txt"]);

const FALLBACK_INDEX_HTML = [
  "<!doctype html>",
  '<html lang="en">',
  "  <head>",
  '    <meta charset="utf-8" />',
  '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
  "    <title>Errors</title>",
  "  </head>",
  "  <body>",
  '    <div id="root"></div>',
  "  </body>",
  "</html>",
].join("\n");

function createSpaAssetResponder(clientRoot: string) {
  const baseDir = path.resolve(clientRoot);

  const openRelativeAsset = async (
    relativeRequestPath: string,
  ): Promise<ReturnType<typeof Bun.file> | null> => {
    const cleanRel = relativeRequestPath.replace(/^\/+/u, "");
    const targetPath = path.resolve(baseDir, cleanRel);
    const relFromRoot = path.relative(baseDir, targetPath);
    if (
      relFromRoot === "" ||
      relFromRoot.startsWith("..") ||
      path.isAbsolute(relFromRoot)
    ) {
      return null;
    }
    const handle = Bun.file(targetPath);
    return (await handle.exists()) ? handle : null;
  };

  const serveCachedAsset = async (
    relativeRequestPath: string,
    cacheControl: string,
  ): Promise<Response | null> => {
    const handle = await openRelativeAsset(relativeRequestPath);
    if (handle === null) {
      return null;
    }
    return new Response(handle, {
      status: 200,
      headers: {
        "Content-Type": handle.type,
        "Cache-Control": cacheControl,
      },
    });
  };

  const renderShellDocument = async (): Promise<Response> => {
    const indexHandle = await openRelativeAsset("index.html");
    const html =
      indexHandle === null ? FALLBACK_INDEX_HTML : await indexHandle.text();
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  };

  return { serveCachedAsset, renderShellDocument };
}

function classifyErrorsRoute(pathname: string): string {
  if (
    pathname === "/healthz" ||
    pathname === "/readyz" ||
    pathname === "/metrics"
  ) {
    return pathname;
  }
  if (pathname.startsWith("/api/v1/")) {
    return "/api/v1";
  }
  if (pathname.startsWith("/api/")) {
    return "/api/:projectId/envelope";
  }
  return pathname.startsWith("/assets/") ? "/assets" : "/";
}

function mountOperationalEndpoints(
  app: Hono,
  repo: ErrorsRepository,
  metrics: ErrorsMetrics,
): void {
  app.get("/healthz", (c) => c.text("ok", 200));
  app.get("/readyz", async (c) =>
    (await repo.ping()) ? c.text("ready", 200) : c.text("not ready", 503),
  );
  app.get("/metrics", async () => {
    metrics.refreshFromSnapshot(await repo.getMetricsSnapshot());
    return new Response(await metrics.register.metrics(), {
      status: 200,
      headers: { "Content-Type": metrics.register.contentType },
    });
  });
}

export function createAdminApp(deps: AdminAppDeps): Hono {
  const app = new Hono();
  const metrics = deps.metrics ?? createErrorsMetrics();
  const spaAssets = createSpaAssetResponder(
    deps.clientRoot ?? DEFAULT_CLIENT_ROOT,
  );
  const ingestRuntime = resolveIngestRuntime({
    repo: deps.repo,
    ingestEnabled: deps.ingestEnabled,
    rateLimiter: deps.rateLimiter,
    metrics,
    onOutboxQueued: deps.onOutboxQueued,
  });

  app.use(secureHeaders());
  app.use((c, next) =>
    traceRequest(c.req.raw, classifyErrorsRoute(c.req.path), next),
  );

  mountOperationalEndpoints(app, deps.repo, metrics);

  for (const envelopeRoute of [
    "/api/:projectId/envelope",
    "/api/:projectId/envelope/",
  ]) {
    app.options(envelopeRoute, (c) => handleEnvelopeOptions(c));
    app.post(envelopeRoute, (c) => handleEnvelopePost(c, ingestRuntime));
  }

  registerAdminApiRoutes(app, deps);
  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

  // Legacy Bugsink issue detail URL redirects: /issues/issue/:uuid(/...) -> 301 /issues/:uuid
  app.get("/issues/issue/:uuid", (c) =>
    c.redirect(`/issues/${encodeURIComponent(c.req.param("uuid"))}`, 301),
  );
  app.get("/issues/issue/:uuid/*", (c) =>
    c.redirect(`/issues/${encodeURIComponent(c.req.param("uuid"))}`, 301),
  );

  // Legacy Bugsink numeric project issue list URL redirects: /issues/:projectId(/) -> 301 /projects/:slug
  const handleIssuesSegment = async (rawSegment: string): Promise<Response> => {
    const numericId = parsePositiveIntId(rawSegment);
    if (numericId !== null) {
      const project = await deps.repo.getProject(numericId);
      const destination =
        project === null
          ? `/issues?project=${String(numericId)}`
          : `/projects/${project.slug}`;
      return new Response(null, {
        status: 301,
        headers: { Location: destination },
      });
    }
    return spaAssets.renderShellDocument();
  };

  app.get("/issues/:segment", (c) =>
    handleIssuesSegment(c.req.param("segment")),
  );
  app.get("/issues/:segment/", (c) =>
    handleIssuesSegment(c.req.param("segment")),
  );

  app.get("/assets/*", async (c) => {
    const asset = await spaAssets.serveCachedAsset(
      c.req.path,
      "public, max-age=31536000, immutable",
    );
    return asset ?? c.notFound();
  });
  app.all("/assets/*", (c) => c.notFound());

  app.get("*", async (c) => {
    const trimmed = c.req.path.slice(1);
    if (ROOT_PUBLIC_FILES.has(trimmed)) {
      const rootAsset = await spaAssets.serveCachedAsset(
        trimmed,
        "public, max-age=3600",
      );
      return rootAsset ?? c.notFound();
    }
    return spaAssets.renderShellDocument();
  });

  app.onError((error, c) => {
    console.error(
      JSON.stringify({
        message: "errors_admin_request_failed",
        path: c.req.path,
        error: error.message,
      }),
    );
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
}
