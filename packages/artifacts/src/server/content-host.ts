import type { ContentCatalog } from "#application/content-catalog.ts";
import type { TokenCache } from "#application/token-cache.ts";
import { servedType, isHtml } from "#domain/content-types.ts";
import { contentHeaders, type ContentOrigins } from "#domain/csp.ts";
import { injectBridge } from "#domain/html-inject.ts";
import { isTokenFormat, resolveContentPath } from "#domain/paths.ts";
import { ifRangeMatches, noneMatch, parseRange } from "#domain/range.ts";
import { reportError } from "#infrastructure/log.ts";
import type { ObjectStore } from "#infrastructure/object-store.ts";
import type { Metrics } from "#infrastructure/metrics.ts";
import {
  mermaidViewerHtml,
  type BridgeAssets,
  type StaticAsset,
  type ViewerAssets,
} from "./assets.ts";
import { operatorLogin } from "./auth.ts";

const IMMUTABLE = "private, max-age=31536000, immutable";
const TOKEN_PATH = /^\/_t\/([^/]+)(\/.*)?$/u;
const STATIC_PATH = /^\/_(bridge|viewer)\/([\w.-]+)$/u;

export type ContentHostOptions = {
  catalog: ContentCatalog;
  store: ObjectStore;
  tokens: TokenCache;
  origins: ContentOrigins;
  bridge: BridgeAssets;
  viewer: ViewerAssets;
  metrics: Metrics;
  operatorLogins: () => Promise<string[]>;
};

/** Everything a content response carries; built per request, token-scoped. */
function baseHeaders(options: ContentHostOptions, token: string | null) {
  return new Headers(contentHeaders(options.origins, token));
}

function plain(
  options: ContentHostOptions,
  status: number,
  token: string | null,
  extra: Record<string, string> = {},
): Response {
  const headers = baseHeaders(options, token);
  headers.set("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Response(status === 304 || status === 204 ? null : "", {
    status,
    headers,
  });
}

function attachmentName(path: string): string {
  const name = path.split("/").pop() ?? "download";
  const ascii = name.replaceAll(/[^\w.-]/gu, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * The content host: GET, HEAD and OPTIONS of `/_t/<token>/*`, `/_bridge/*`
 * and `/_viewer/*`, and nothing else. It is the only code that reads object
 * bytes, and every response carries the sandbox headers whatever its status.
 */
export function createContentHandler(options: ContentHostOptions) {
  async function lookup(token: string) {
    const cached = options.tokens.get(token);
    if (cached !== undefined) return cached;
    const entry = await options.catalog.findVersion(token);
    if (entry === null) return null;
    options.tokens.set(token, entry);
    return entry;
  }

  function staticAsset(request: Request, asset: StaticAsset): Response {
    const headers = baseHeaders(options, null);
    headers.set("Content-Type", asset.contentType);
    headers.set("ETag", asset.etag);
    headers.set("Cache-Control", IMMUTABLE);
    if (noneMatch(request.headers.get("If-None-Match"), asset.etag))
      return new Response(null, { status: 304, headers });
    headers.set("Content-Length", String(asset.bytes.length));
    return new Response(request.method === "HEAD" ? null : asset.bytes, {
      headers,
    });
  }

  async function serveStatic(request: Request, kind: string, file: string) {
    if (kind === "bridge") {
      const asset = options.bridge.get(file);
      return asset === undefined
        ? plain(options, 404, null)
        : staticAsset(request, asset);
    }
    const asset = await options.viewer.get(file);
    return asset === undefined
      ? plain(options, 404, null)
      : staticAsset(request, asset);
  }

  async function serveMermaidViewer(
    request: Request,
    token: string,
    entryPath: string,
  ): Promise<Response> {
    const html = mermaidViewerHtml({
      entryPath,
      viewerScript: await options.viewer.mermaidEntry(),
      bridgeSrc: options.bridge.src,
    });
    const headers = baseHeaders(options, token);
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("Cache-Control", "no-cache");
    return new Response(request.method === "HEAD" ? null : html, { headers });
  }

  async function serveFile(
    request: Request,
    token: string,
    versionId: string,
    path: string,
  ): Promise<Response> {
    const file = await options.catalog.findFile(versionId, path);
    if (file === null) return plain(options, 404, token);
    const size = file.size;
    const served = servedType(file.mediaType);
    const html = served.inline && isHtml(file.mediaType);
    const etag = html
      ? `"${file.sha256}-b${options.bridge.hash}"`
      : `"${file.sha256}"`;
    const headers = baseHeaders(options, token);
    headers.set("Content-Type", served.contentType);
    headers.set("ETag", etag);
    headers.set("Cache-Control", IMMUTABLE);
    if (!served.inline)
      headers.set("Content-Disposition", attachmentName(path));
    if (noneMatch(request.headers.get("If-None-Match"), etag))
      return new Response(null, { status: 304, headers });
    const head = request.method === "HEAD";
    if (html) {
      // Rewritten HTML has no Range and no Content-Length: its size changed.
      if (head) return new Response(null, { headers });
      const stream = injectBridge(
        options.store.read(file.storageKey),
        options.bridge.src,
        headers,
      );
      return new Response(stream, { headers });
    }
    headers.set("Accept-Ranges", "bytes");
    const range = ifRangeMatches(request.headers.get("If-Range"), etag)
      ? parseRange(request.headers.get("Range"), size)
      : ({ type: "full" } as const);
    if (range.type === "unsatisfiable") {
      headers.set("Content-Range", `bytes */${String(size)}`);
      return new Response(null, { status: 416, headers });
    }
    if (range.type === "partial") {
      headers.set(
        "Content-Range",
        `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`,
      );
      headers.set("Content-Length", String(range.end - range.start + 1));
      return new Response(
        head
          ? null
          : options.store.readRange(file.storageKey, range.start, range.end),
        { status: 206, headers },
      );
    }
    headers.set("Content-Length", String(size));
    return new Response(head ? null : options.store.read(file.storageKey), {
      headers,
    });
  }

  async function route(
    request: Request,
    url: URL,
  ): Promise<{ response: Response; route: string }> {
    const fixed = STATIC_PATH.exec(url.pathname);
    if (fixed !== null)
      return {
        response: await serveStatic(request, fixed[1] ?? "", fixed[2] ?? ""),
        route: "static",
      };
    const match = TOKEN_PATH.exec(url.pathname);
    if (match === null)
      return { response: plain(options, 404, null), route: "other" };
    const token = match[1] ?? "";
    if (!isTokenFormat(token))
      return { response: plain(options, 404, null), route: "file" };
    if (match[2] === undefined)
      return {
        response: plain(options, 308, token, {
          Location: `/_t/${token}/${url.search}`,
        }),
        route: "file",
      };
    const version = await lookup(token);
    if (version === null)
      return { response: plain(options, 404, token), route: "file" };
    const rest = match[2].slice(1);
    const resolved = resolveContentPath(rest, version.entryPath);
    if (resolved.type === "invalid")
      return { response: plain(options, 400, token), route: "file" };
    if (rest === "" && version.kind === "mermaid")
      return {
        response: await serveMermaidViewer(request, token, version.entryPath),
        route: "viewer",
      };
    return {
      response: await serveFile(
        request,
        token,
        version.versionId,
        resolved.path,
      ),
      route: "file",
    };
  }

  async function handleChecked(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const tokenForHeaders = TOKEN_PATH.exec(url.pathname)?.[1] ?? null;
    let outcome: { response: Response; route: string };
    const login = operatorLogin(request.headers);
    const allowed = await options.operatorLogins();
    if (login === null || !allowed.includes(login)) {
      options.metrics.csrfRejection("login");
      outcome = {
        response: plain(options, 403, tokenForHeaders),
        route: "denied",
      };
    } else if (request.method === "OPTIONS") {
      outcome = {
        response: plain(options, 204, tokenForHeaders, {
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Range, If-None-Match, If-Range",
          "Access-Control-Max-Age": "86400",
        }),
        route: "options",
      };
    } else if (request.method === "GET" || request.method === "HEAD") {
      outcome = await route(request, url);
    } else {
      outcome = {
        response: plain(options, 404, tokenForHeaders),
        route: "other",
      };
    }
    options.metrics.requests({
      host: "content",
      route: outcome.route,
      status: outcome.response.status,
    });
    return outcome.response;
  }

  /** An unexpected failure still answers with the sandbox headers, token-free. */
  return async function handle(request: Request): Promise<Response> {
    try {
      return await handleChecked(request);
    } catch (error) {
      reportError(error, "artifacts_content_request_failed");
      const token = TOKEN_PATH.exec(new URL(request.url).pathname)?.[1] ?? null;
      options.metrics.requests({
        host: "content",
        route: "error",
        status: 500,
      });
      return plain(options, 500, token);
    }
  };
}
