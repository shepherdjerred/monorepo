/**
 * The content host of the fake service: `GET|HEAD|OPTIONS /_t/<token>/<path>`
 * and `/_bridge/v1.js`, nothing else. It mirrors the real host's isolation
 * headers, injects the bridge into HTML and serves `Range` requests so video
 * seeking works. There is no tRPC and no cookie on this origin.
 */
import {
  ALLOWED_CDN_ORIGINS,
  normalizeArtifactPath,
} from "#shared/contract.ts";
import { buildBridge, type BridgeAssets } from "#server/assets.ts";

export type ContentFile = {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
  readonly mediaType: string;
};

export type ContentVersion = {
  readonly entryPath: string;
  readonly files: ReadonlyMap<string, ContentFile>;
};

export type ContentSource = {
  readonly resolveToken: (token: string) => ContentVersion | null;
  readonly blob: (sha256: string) => Blob | null;
  readonly origins: () => { readonly app: string; readonly content: string };
};

const TOKEN_PATH = /^\/_t\/([\w-]+)\/(.*)$/u;
const CDN = ALLOWED_CDN_ORIGINS.join(" ");
const ALLOW = "GET, HEAD, OPTIONS";

/** Types a browser may render inline; anything else is offered as a download. */
const INLINE_TYPE =
  /^(?:text\/|image\/|video\/|audio\/|font\/|application\/(?:pdf|json|javascript|xml|wasm|x-asciicast))/u;

/** The Content-Security-Policy of one token prefix, adapted so every source is an absolute origin plus path. */
export function contentSecurityPolicy(
  prefix: string,
  origins: { readonly app: string; readonly content: string },
): string {
  return [
    "sandbox allow-scripts allow-forms allow-popups",
    "default-src 'none'",
    `img-src ${prefix} data:`,
    `media-src ${prefix}`,
    `style-src ${prefix} 'unsafe-inline' ${CDN}`,
    `script-src ${prefix} ${origins.content}/_bridge/ 'unsafe-inline' ${CDN}`,
    `font-src ${prefix} ${CDN}`,
    `connect-src ${prefix}`,
    "form-action 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    `frame-ancestors ${origins.app}`,
  ].join("; ");
}

function baseHeaders(
  prefix: string,
  origins: { readonly app: string; readonly content: string },
): Headers {
  return new Headers({
    "Content-Security-Policy": contentSecurityPolicy(prefix, origins),
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Access-Control-Expose-Headers":
      "Content-Length, Content-Range, Accept-Ranges, ETag",
  });
}

function failure(
  status: number,
  message: string,
  headers: Headers,
  extra: Record<string, string> = {},
): Response {
  headers.set("Content-Type", "text/plain; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Response(message, { status, headers });
}

type ByteRange = { readonly start: number; readonly end: number };

function suffixRange(suffix: number, size: number): ByteRange | "invalid" {
  return suffix === 0 || size === 0
    ? "invalid"
    : { start: Math.max(0, size - suffix), end: size - 1 };
}

/** `null` when the header asks for the whole body (or several ranges), `"invalid"` when unsatisfiable. */
function parseRange(
  header: string,
  size: number,
): ByteRange | "invalid" | null {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (match === null) return null;
  const first = match[1] ?? "";
  const last = match[2] ?? "";
  if (first === "" && last === "") return "invalid";
  if (first === "") return suffixRange(Number(last), size);
  const start = Number(first);
  if (start >= size) return "invalid";
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  return end < start ? "invalid" : { start, end };
}

function withCharset(mediaType: string): string {
  return mediaType.startsWith("text/") && !mediaType.includes("charset")
    ? `${mediaType}; charset=utf-8`
    : mediaType;
}

function isHtml(mediaType: string): boolean {
  return mediaType.split(";")[0]?.trim().toLowerCase() === "text/html";
}

/** Prepends the bridge script before the first element of the document. */
function injectBridge(response: Response): Response {
  const tag = `<script src="/_bridge/v1.js"></script>`;
  let done = false;
  return new HTMLRewriter()
    .on("*", {
      element(element) {
        if (done) return;
        done = true;
        const inside = element.tagName === "html" || element.tagName === "head";
        element[inside ? "prepend" : "before"](tag, { html: true });
      },
    })
    .transform(response);
}

const bridges = new Map<string, Promise<BridgeAssets>>();

/** The service's own bridge script, built the way the real content host builds it. */
function bridgeFor(appOrigin: string): Promise<BridgeAssets> {
  const known = bridges.get(appOrigin);
  if (known !== undefined) return known;
  const built = buildBridge(appOrigin);
  bridges.set(appOrigin, built);
  return built;
}

async function serveBridge(
  request: Request,
  origins: { readonly app: string; readonly content: string },
): Promise<Response> {
  const headers = baseHeaders(`${origins.content}/_bridge/`, origins);
  headers.set("Content-Type", "text/javascript; charset=utf-8");
  headers.set("Cache-Control", "no-cache");
  const bridge = await bridgeFor(origins.app);
  const asset = bridge.get("v1.js");
  if (asset === undefined) return new Response(null, { status: 404, headers });
  return new Response(request.method === "HEAD" ? null : asset.bytes, {
    headers,
  });
}

type FileResponse = {
  readonly request: Request;
  readonly file: ContentFile;
  readonly blob: Blob;
  readonly headers: Headers;
};

function serveFile({ request, file, blob, headers }: FileResponse): Response {
  const html = isHtml(file.mediaType);
  headers.set("Content-Type", withCharset(file.mediaType));
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  headers.set("ETag", html ? `W/"${file.sha256}-b1"` : `"${file.sha256}"`);
  if (!INLINE_TYPE.test(file.mediaType))
    headers.set(
      "Content-Disposition",
      `attachment; filename="${file.path.split("/").pop() ?? "file"}"`,
    );
  if (request.headers.get("If-None-Match") === headers.get("ETag"))
    return new Response(null, { status: 304, headers });
  const head = request.method === "HEAD";
  if (html) {
    return injectBridge(new Response(head ? null : blob, { headers }));
  }
  headers.set("Accept-Ranges", "bytes");
  const requested = request.headers.get("Range");
  const range = requested === null ? null : parseRange(requested, file.size);
  if (range === "invalid")
    return failure(416, "range not satisfiable", headers, {
      "Content-Range": `bytes */${String(file.size)}`,
    });
  if (range === null) {
    headers.set("Content-Length", String(file.size));
    return new Response(head ? null : blob, { status: 200, headers });
  }
  headers.set(
    "Content-Range",
    `bytes ${String(range.start)}-${String(range.end)}/${String(file.size)}`,
  );
  headers.set("Content-Length", String(range.end - range.start + 1));
  return new Response(head ? null : blob.slice(range.start, range.end + 1), {
    status: 206,
    headers,
  });
}

/** The artifact path a request names, or null when it is not a valid one. */
function resolvePath(encoded: string, entryPath: string): string | null {
  try {
    const requested = decodeURIComponent(encoded);
    return requested === "" ? entryPath : normalizeArtifactPath(requested);
  } catch {
    return null;
  }
}

export function createContentHandler(
  source: ContentSource,
): (request: Request) => Response | Promise<Response> {
  return (request) => {
    const url = new URL(request.url);
    const origins = source.origins();
    if (
      url.pathname === "/_bridge/v1.js" &&
      (request.method === "GET" || request.method === "HEAD")
    )
      return serveBridge(request, origins);
    const match = TOKEN_PATH.exec(url.pathname);
    const token = match?.[1];
    const headers = baseHeaders(
      token === undefined
        ? `${origins.content}/_t/`
        : `${origins.content}/_t/${token}/`,
      origins,
    );
    if (match === null || token === undefined)
      return failure(404, "not found", headers);
    if (request.method === "OPTIONS") {
      headers.set("Access-Control-Allow-Methods", ALLOW);
      headers.set(
        "Access-Control-Allow-Headers",
        "Range, If-None-Match, If-Match, Content-Type",
      );
      headers.set("Access-Control-Max-Age", "86400");
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "GET" && request.method !== "HEAD")
      return failure(405, "method not allowed", headers, { Allow: ALLOW });
    const version = source.resolveToken(token);
    if (version === null) return failure(404, "not found", headers);
    const path = resolvePath(match[2] ?? "", version.entryPath);
    const file = path === null ? undefined : version.files.get(path);
    const blob = file === undefined ? null : source.blob(file.sha256);
    return file === undefined || blob === null
      ? failure(404, "not found", headers)
      : serveFile({ request, file, blob, headers });
  };
}
