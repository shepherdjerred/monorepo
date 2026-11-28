import path from "node:path";
import {
  createConsoleServer,
  identityOf,
  LOOPBACK_PROXIES,
  tailscaleIdentity,
  type ConsoleEnv,
  type ConsoleServer,
} from "@shepherdjerred/console-server";
import type { Context, Hono } from "hono";
import type { PlatformSiteEntry } from "#domain/platform-sites.ts";
import { buildCatalog, resolveRedirect } from "#domain/resolver.ts";
import type { ManualLinkRepository } from "#infrastructure/db.ts";
import {
  createGolinkMetrics,
  reportError,
  type GolinkMetrics,
} from "#infrastructure/telemetry.ts";
import {
  normalizeShortSlug,
  RESERVED_SLUGS,
  UpsertManualLinkInputSchema,
  validateShortSlug,
} from "#shared/contract.ts";
import {
  createLinksService,
  LinksError,
  type LinksService,
} from "./links-service.ts";
import { golinkRouter, viewerOf } from "./trpc-router.ts";

export type GolinkAppDeps = {
  readonly repo: ManualLinkRepository;
  readonly getIngressHosts: () => readonly string[];
  readonly platformSites: readonly PlatformSiteEntry[];
  readonly tailnetDomain?: string;
  readonly dynamicAliasesEnabled: () => Promise<boolean>;
  readonly writesEnabled: () => Promise<boolean>;
  readonly metrics?: GolinkMetrics;
  readonly clientRoot?: string;
  readonly port?: number;
  readonly hostname?: string;
  /** Runs after the listener drains (discovery, database, flags, telemetry). */
  readonly onShutdown?: () => Promise<void>;
};

type GolinkContext = Context<ConsoleEnv>;

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

async function readIndexHtml(clientRoot: string): Promise<string> {
  const indexFile = Bun.file(path.join(clientRoot, "index.html"));
  return (await indexFile.exists()) ? indexFile.text() : FALLBACK_INDEX_HTML;
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

function linksErrorResponse(c: GolinkContext, error: unknown): Response {
  if (error instanceof LinksError) {
    return error.kind === "writes-disabled"
      ? c.json({ error: error.message }, 403)
      : c.json({ error: error.message }, 500);
  }
  throw error;
}

/**
 * `/api/links` as REST. The browser now uses the `links` tRPC procedures;
 * these stay, unchanged, for the callers listed in the README until their
 * request count is zero (serve both, move callers, then delete).
 */
function registerRestLinkRoutes(
  app: Hono<ConsoleEnv>,
  links: LinksService,
  writesEnabled: () => Promise<boolean>,
): void {
  app.get("/api/links", async (c) => {
    const identity = await identityOf(c);
    return c.json(await links.directory(viewerOf(identity)), 200);
  });

  app.post("/api/links", async (c) => {
    if (!(await writesEnabled())) {
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
    const identity = await identityOf(c);
    try {
      return c.json(await links.upsert(parsed.data, viewerOf(identity)), 200);
    } catch (error) {
      return linksErrorResponse(c, error);
    }
  });

  app.delete("/api/links/:short", async (c) => {
    if (!(await writesEnabled())) {
      return c.json({ error: "Golink writes are currently disabled." }, 403);
    }
    const short = normalizeShortSlug(c.req.param("short"));
    const validationError = validateShortSlug(short);
    if (validationError !== null) {
      return c.json({ error: validationError }, 400);
    }
    try {
      return c.json(await links.remove(short), 200);
    } catch (error) {
      return linksErrorResponse(c, error);
    }
  });

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
}

export function createGolinkServer(deps: GolinkAppDeps): ConsoleServer {
  const tailnetDomain = deps.tailnetDomain ?? "tailnet-1a49.ts.net";
  const metrics = deps.metrics ?? createGolinkMetrics();
  const clientRoot = deps.clientRoot ?? DEFAULT_CLIENT_ROOT;
  const links = createLinksService({ ...deps, tailnetDomain, metrics });

  const handleRedirect = async (c: GolinkContext): Promise<Response> => {
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

  return createConsoleServer({
    name: "golink",
    port: deps.port ?? 7352,
    ...(deps.hostname === undefined ? {} : { hostname: deps.hostname }),
    // The in-Pod Tailscale sidecar proxies from loopback; identity headers
    // from any other peer (Prometheus, Temporal) are ignored.
    identity: [tailscaleIdentity({ trustedProxies: LOOPBACK_PROXIES })],
    metrics: {
      registry: metrics.register,
      collect: async () => {
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
      },
    },
    health: { ready: { database: async () => deps.repo.ping() } },
    trpc: {
      router: golinkRouter,
      createContext: (input) => ({ ...input, links }),
    },
    staticDir: clientRoot,
    // `/<slug>` is a redirect, so an unknown path is never the SPA shell.
    spaFallback: false,
    routes: (app) => {
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
      registerRestLinkRoutes(app, links, deps.writesEnabled);
      app.get("/:short", handleRedirect);
      app.get("/:short/*", handleRedirect);
    },
    onError: reportError,
    ...(deps.onShutdown === undefined ? {} : { onShutdown: deps.onShutdown }),
  });
}
