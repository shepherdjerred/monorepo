import path from "node:path";
import type { Hono } from "hono";

/** Built client next to this package, which is where the image copies `dist`. */
export function webRootPath(): string {
  return path.join(import.meta.dir, "../../tasknotes-web/dist");
}

export function webIndexExists(root: string): boolean {
  return Bun.file(path.join(root, "index.html")).size > 0;
}

/** Production startup refuses to listen without the built client. */
export function requireWebRoot(root: string): void {
  if (!webIndexExists(root)) {
    throw new Error(
      `TaskNotes web UI is missing at ${path.join(root, "index.html")}`,
    );
  }
}

/**
 * Pages and assets are public. `/api` and `/metrics` stay on the auth path,
 * and any `..` segment stays there too so it cannot be served as a file.
 */
export function isDocumentRequest(
  method: string,
  requestPath: string,
): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch (error_: unknown) {
    if (!(error_ instanceof Error)) throw error_;
    return false;
  }
  if (
    !decoded.startsWith("/") ||
    decoded.includes("\0") ||
    decoded.includes("..")
  ) {
    return false;
  }
  if (decoded === "/metrics" || decoded.startsWith("/metrics/")) return false;
  if (decoded === "/api" || decoded.startsWith("/api/")) return false;
  return true;
}

function requestRelative(requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch (error_: unknown) {
    if (!(error_ instanceof Error)) throw error_;
    return null;
  }
  const pathOnly = decoded.split("?")[0] ?? decoded;
  if (
    !pathOnly.startsWith("/") ||
    pathOnly.includes("\0") ||
    pathOnly.includes("..")
  ) {
    return null;
  }
  const trimmed = pathOnly.replace(/\/+$/, "");
  return trimmed === "" ? "index.html" : trimmed.slice(1);
}

function insideRoot(root: string, full: string): boolean {
  const rel = path.relative(root, full);
  return (
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${path.sep}`) &&
    !rel.startsWith(path.sep)
  );
}

/** A file inside `root`, or `index.html` for a client route. `null` is a 404. */
export function documentTarget(
  root: string,
  requestPath: string,
): string | null {
  const relativePath = requestRelative(requestPath);
  if (relativePath === null) return null;
  const full = path.normalize(path.join(root, relativePath));
  if (!insideRoot(root, full)) return null;
  if (Bun.file(full).size > 0) return full;
  if (relativePath.startsWith("assets/") || relativePath.includes(".")) {
    return null;
  }
  const index = path.join(root, "index.html");
  return webIndexExists(root) ? index : null;
}

function fileResponse(file: Bun.BunFile, method: string): Response {
  const contentType = file.type === "" ? "application/octet-stream" : file.type;
  if (method === "HEAD") {
    return new Response(null, {
      headers: {
        "content-type": contentType,
        "content-length": String(file.size),
      },
    });
  }
  return new Response(file, { headers: { "content-type": contentType } });
}

export function mountWebUi(app: Hono, root: string): void {
  requireWebRoot(root);
  app.use("*", async (c, next) => {
    if (!isDocumentRequest(c.req.method, c.req.path)) {
      await next();
      return;
    }
    const target = documentTarget(root, c.req.path);
    return target === null
      ? c.text("Not found", 404)
      : fileResponse(Bun.file(target), c.req.method);
  });
}
