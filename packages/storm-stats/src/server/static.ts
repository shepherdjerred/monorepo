import path from "node:path";
import type { Hono } from "hono";

export const DEFAULT_CLIENT_ROOT = path.resolve(
  import.meta.dir,
  "../../dist/client",
);

async function resolveSafeClientFile(
  clientRoot: string,
  relativePath: string,
): Promise<ReturnType<typeof Bun.file> | null> {
  const resolvedRoot = path.resolve(clientRoot);
  const stripped = relativePath.replace(/^\/+/u, "");
  if (stripped.length === 0) {
    return null;
  }
  const candidate = path.resolve(resolvedRoot, stripped);
  if (!candidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    return null;
  }
  const file = Bun.file(candidate);
  return (await file.exists()) ? file : null;
}

/**
 * Mounts SPA static asset and HTML fallback routes on a Hono app.
 *
 * Must be registered AFTER `/api/*` routes and `/api/*` 404 catch-alls so
 * unmatched API endpoints never fall back to `index.html`.
 */
export function attachSpaStaticRoutes(app: Hono, clientRoot: string): void {
  app.get("/assets/*", async (c) => {
    const file = await resolveSafeClientFile(clientRoot, c.req.path);
    if (file === null) {
      return c.text("not found", 404);
    }
    return new Response(file, {
      status: 200,
      headers: {
        "Content-Type": file.type,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  });

  app.all("/assets/*", (c) => c.text("not found", 404));

  app.get("*", async (c) => {
    const reqPath = c.req.path;
    if (reqPath !== "/" && path.extname(reqPath).length > 0) {
      const staticFile = await resolveSafeClientFile(clientRoot, reqPath);
      if (staticFile !== null) {
        return new Response(staticFile, {
          status: 200,
          headers: {
            "Content-Type": staticFile.type,
            "Cache-Control": "public, max-age=3600",
          },
        });
      }
      return c.text("not found", 404);
    }

    const indexFile = await resolveSafeClientFile(clientRoot, "index.html");
    if (indexFile === null) {
      return c.text("not found", 404);
    }
    return new Response(await indexFile.text(), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  });
}
