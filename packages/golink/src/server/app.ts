import path from "node:path";
import { Hono, type Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { PlatformSiteEntry } from "#domain/platform-sites.ts";
import {
  buildCatalog,
  computeManualShadows,
  resolveRedirect,
  toManualLinkItem,
} from "#domain/resolver.ts";
import type { ManualLinkRepository } from "#infrastructure/db.ts";
import {
  createGolinkMetrics,
  reportError,
  traceRequest,
  type GolinkMetrics,
} from "#infrastructure/telemetry.ts";
import {
  normalizeShortSlug,
  RESERVED_SLUGS,
  UpsertManualLinkInputSchema,
  validateShortSlug,
  type LinksDirectoryResponse,
  type Viewer,
} from "#shared/contract.ts";

export type GolinkAppDeps = {
  readonly repo: ManualLinkRepository;
  readonly getIngressHosts: () => readonly string[];
  readonly platformSites: readonly PlatformSiteEntry[];
  readonly tailnetDomain?: string;
  readonly dynamicAliasesEnabled: () => Promise<boolean>;
  readonly writesEnabled: () => Promise<boolean>;
  readonly metrics?: GolinkMetrics;
  readonly clientRoot?: string;
};

const DEFAULT_CLIENT_ROOT = path.resolve(import.meta.dir, "../../dist/client");

const FALLBACK_INDEX_HTML = [
  "<!doctype html>",
  '<html lang="en">',
  "  <head>",
  '    <meta charset="utf-8" />',
  '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
  "    <title>go/</title>",
  "  </head>",
  "  <body>",
  '    <div id="root"></div>',
  "  </body>",
  "</html>",
].join("\n");

function headerOrNull(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractViewer(header: (name: string) => string | undefined): Viewer {
  return {
    login: headerOrNull(header("Tailscale-User-Login")),
    displayName: headerOrNull(header("Tailscale-User-Name")),
  };
}

function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function parseRedirectPath(rawUrl: string): {
  readonly short: string;
  readonly subpath: string;
  readonly search: string;
} {
  const parsed = new URL(rawUrl);
  const withoutLeadingSlash = parsed.pathname.replace(/^\/+/u, "");
  const slashIndex = withoutLeadingSlash.indexOf("/");
  if (slashIndex === -1) {
    return {
      short: normalizeShortSlug(safeDecodeSegment(withoutLeadingSlash)),
      subpath: "",
      search: parsed.search,
    };
  }
  const rawShort = withoutLeadingSlash.slice(0, slashIndex);
  const subpath = withoutLeadingSlash.slice(slashIndex + 1);
  return {
    short: normalizeShortSlug(safeDecodeSegment(rawShort)),
    subpath,
    search: parsed.search,
  };
}

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
  if (pathname === "/healthz" || pathname === "/readyz") {
    return pathname;
  }
  if (pathname === "/metrics" || pathname === "/.export") {
    return pathname;
  }
  if (pathname.startsWith("/api/")) {
    return "/api";
  }
  if (pathname.startsWith("/assets/")) {
    return "/assets";
  }
  return pathname === "/" ? "/" : "/:short";
}

async function recordClickSafely(
  repo: ManualLinkRepository,
  short: string,
): Promise<void> {
  try {
    await repo.recordClick(short);
  } catch (error) {
    reportError(error);
  }
}

export function createGolinkApp(deps: GolinkAppDeps): Hono {
  const app = new Hono();
  const tailnetDomain = deps.tailnetDomain ?? "tailnet-1a49.ts.net";
  const metrics = deps.metrics ?? createGolinkMetrics();
  const clientRoot = deps.clientRoot ?? DEFAULT_CLIENT_ROOT;

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
    const [manualLinks, dynamicAliasesEnabled] = await Promise.all([
      deps.repo.list(),
      deps.dynamicAliasesEnabled(),
    ]);
    const catalog = buildCatalog({
      manualLinks,
      ingressHosts: deps.getIngressHosts(),
      platformSites: deps.platformSites,
      tailnetDomain,
      dynamicAliasesEnabled,
    });
    metrics.updateLinksConfigured(catalog.links, catalog.shortcuts.length);
    return new Response(await metrics.register.metrics(), {
      status: 200,
      headers: { "Content-Type": metrics.register.contentType },
    });
  });

  app.get("/.export", async (c) => {
    const manualLinks = await deps.repo.list();
    const lines = manualLinks.map((link) =>
      JSON.stringify({
        Short: link.short,
        Long: link.targetUrl,
        Created: link.createdAt.toISOString(),
        LastEdit: link.updatedAt.toISOString(),
        Owner: link.createdBy,
      }),
    );
    const body = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
    return c.body(body, 200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    });
  });

  app.get("/api/links", async (c) => {
    const [manualLinks, dynamicAliasesEnabled, writesEnabled] =
      await Promise.all([
        deps.repo.list(),
        deps.dynamicAliasesEnabled(),
        deps.writesEnabled(),
      ]);
    const catalog = buildCatalog({
      manualLinks,
      ingressHosts: deps.getIngressHosts(),
      platformSites: deps.platformSites,
      tailnetDomain,
      dynamicAliasesEnabled,
    });
    metrics.updateLinksConfigured(catalog.links, catalog.shortcuts.length);

    const payload: LinksDirectoryResponse = {
      viewer: extractViewer((name) => c.req.header(name)),
      dynamicAliasesEnabled,
      writesEnabled,
      links: catalog.links,
      shortcuts: catalog.shortcuts,
    };
    return c.json(payload, 200);
  });

  app.post("/api/links", async (c) => {
    if (!(await deps.writesEnabled())) {
      return c.json({ error: "Golink writes are currently disabled." }, 403);
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON." }, 400);
    }

    const parsed = UpsertManualLinkInputSchema.safeParse(rawBody);
    if (!parsed.success) {
      const joined = parsed.error.issues
        .map((issue) => issue.message)
        .join(" ");
      const message = joined.length > 0 ? joined : "Invalid link input.";
      return c.json({ error: message }, 400);
    }

    const viewer = extractViewer((name) => c.req.header(name));
    const createdBy = viewer.login ?? "manual";
    const saved = await deps.repo.upsert(parsed.data, createdBy);
    const dynamicAliasesEnabled = await deps.dynamicAliasesEnabled();
    const shadows = computeManualShadows({
      short: saved.short,
      ingressHosts: deps.getIngressHosts(),
      platformSites: deps.platformSites,
      tailnetDomain,
      dynamicAliasesEnabled,
    });
    const item = toManualLinkItem(saved, shadows);
    return item === null
      ? c.json({ error: "Stored destination URL is invalid." }, 500)
      : c.json(item, 200);
  });

  app.delete("/api/links/:short", async (c) => {
    if (!(await deps.writesEnabled())) {
      return c.json({ error: "Golink writes are currently disabled." }, 403);
    }
    const short = normalizeShortSlug(c.req.param("short"));
    const validationError = validateShortSlug(short);
    if (validationError !== null) {
      return c.json({ error: validationError }, 400);
    }
    await deps.repo.delete(short);
    return c.json({ deleted: true }, 200);
  });

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

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

  app.get("/", async (c) => {
    const html = await readIndexHtml(clientRoot);
    return c.html(html, 200, { "Cache-Control": "no-cache" });
  });

  const handleRedirect = async (c: Context): Promise<Response> => {
    const { short, subpath, search } = parseRedirectPath(c.req.url);
    if (RESERVED_SLUGS.has(short)) {
      return c.json({ error: "Not found" }, 404);
    }

    const [manualLinks, dynamicAliasesEnabled] = await Promise.all([
      deps.repo.list(),
      deps.dynamicAliasesEnabled(),
    ]);

    const resolved = resolveRedirect({
      short,
      subpath,
      search,
      manualLinks,
      ingressHosts: deps.getIngressHosts(),
      platformSites: deps.platformSites,
      tailnetDomain,
      dynamicAliasesEnabled,
    });

    if (resolved !== null) {
      if (resolved.kind === "manual") {
        void recordClickSafely(deps.repo, resolved.matchedShort);
      }
      metrics.redirectsTotal.inc({ kind: resolved.kind });
      return new Response(null, {
        status: 302,
        headers: {
          Location: resolved.location,
          "Cache-Control": "no-store",
        },
      });
    }

    const accept = c.req.header("Accept") ?? "";
    if (accept.includes("text/html")) {
      const html = await readIndexHtml(clientRoot);
      return c.html(html, 404, { "Cache-Control": "no-store" });
    }
    return c.json({ error: "Link not found", short }, 404);
  };

  app.get("/:short", (c) => handleRedirect(c));
  app.get("/:short/*", (c) => handleRedirect(c));

  app.onError((error, c) => {
    console.error(
      JSON.stringify({
        message: "golink_request_failed",
        path: c.req.path,
        error: error.message,
      }),
    );
    reportError(error);
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
}
