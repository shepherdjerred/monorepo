import path from "node:path";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { IngestRateLimiter } from "#domain/rate-limit.ts";
import { parsePositiveIntId } from "#infrastructure/repository-helpers.ts";
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

async function resolveClientFile(
  clientRoot: string,
  relativePath: string,
): Promise<ReturnType<typeof Bun.file> | null> {
  const resolvedRoot = path.resolve(clientRoot);
  const stripped = relativePath.replace(/^\/+/u, "");
  const candidate = path.resolve(resolvedRoot, stripped);
  if (!candidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    return null;
  }
  const file = Bun.file(candidate);
  return (await file.exists()) ? file : null;
}

async function readIndexHtml(clientRoot: string): Promise<string> {
  const indexFile = await resolveClientFile(clientRoot, "index.html");
  return indexFile === null ? FALLBACK_INDEX_HTML : indexFile.text();
}

function classifyRouteForTrace(pathname: string): string {
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

export function createAdminApp(deps: AdminAppDeps): Hono {
  const app = new Hono();
  const metrics = deps.metrics ?? createErrorsMetrics();
  const clientRoot = deps.clientRoot ?? DEFAULT_CLIENT_ROOT;
  const ingestRuntime = resolveIngestRuntime({
    repo: deps.repo,
    ingestEnabled: deps.ingestEnabled,
    rateLimiter: deps.rateLimiter,
    metrics,
    onOutboxQueued: deps.onOutboxQueued,
  });

  app.use(secureHeaders());

  app.use(async (c, next) => {
    const route = classifyRouteForTrace(c.req.path);
    await traceRequest(c.req.raw, route, next);
  });

  app.get("/healthz", (c) => c.text("ok", 200));

  app.get("/readyz", async (c) => {
    const healthy = await deps.repo.ping();
    return healthy ? c.text("ready", 200) : c.text("not ready", 503);
  });

  app.get("/metrics", async () => {
    const snapshot = await deps.repo.getMetricsSnapshot();
    metrics.refreshFromSnapshot(snapshot);
    return new Response(await metrics.register.metrics(), {
      status: 200,
      headers: { "Content-Type": metrics.register.contentType },
    });
  });

  app.options("/api/:projectId/envelope", (c) => handleEnvelopeOptions(c));
  app.options("/api/:projectId/envelope/", (c) => handleEnvelopeOptions(c));
  app.post("/api/:projectId/envelope", (c) =>
    handleEnvelopePost(c, ingestRuntime),
  );
  app.post("/api/:projectId/envelope/", (c) =>
    handleEnvelopePost(c, ingestRuntime),
  );

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
    const html = await readIndexHtml(clientRoot);
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  };

  app.get("/issues/:segment", (c) =>
    handleIssuesSegment(c.req.param("segment")),
  );
  app.get("/issues/:segment/", (c) =>
    handleIssuesSegment(c.req.param("segment")),
  );

  app.get("/assets/*", async (c) => {
    const file = await resolveClientFile(clientRoot, c.req.path);
    if (file === null) {
      return c.notFound();
    }
    return new Response(file, {
      status: 200,
      headers: {
        "Content-Type": file.type,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  });
  app.all("/assets/*", (c) => c.notFound());

  for (const staticName of ["favicon.ico", "favicon.svg", "robots.txt"]) {
    app.get(`/${staticName}`, async (c) => {
      const file = await resolveClientFile(clientRoot, staticName);
      if (file === null) {
        return c.notFound();
      }
      return new Response(file, {
        status: 200,
        headers: {
          "Content-Type": file.type,
          "Cache-Control": "public, max-age=3600",
        },
      });
    });
  }

  app.get("*", async (c) => {
    const html = await readIndexHtml(clientRoot);
    return c.html(html, 200, { "Cache-Control": "no-cache" });
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
