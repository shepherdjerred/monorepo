import path from "node:path";
import { serveStatic } from "@hono/bun";
import type { Context, Hono } from "hono";
import type { ConsoleEnv } from "./context.ts";

export const IMMUTABLE = "public, max-age=31536000, immutable";
export const NO_CACHE = "no-cache";
export const SHORT_CACHE = "public, max-age=3600";

/**
 * Vite fingerprints everything under `assets/`, so those never change;
 * `index.html` names the current fingerprints, so it is revalidated on every
 * load; other root files (favicon, robots.txt) are cached for an hour.
 */
export function cacheControlFor(relativePath: string): string {
  const normalized = relativePath.split(path.sep).join("/");
  if (normalized.startsWith("assets/")) return IMMUTABLE;
  return normalized === "index.html" ? NO_CACHE : SHORT_CACHE;
}

/**
 * Serves the client build. A missing hashed asset is a 404, never the SPA
 * shell; any other missing file falls through to the app's own routes.
 */
export function mountStaticFiles(app: Hono<ConsoleEnv>, root: string): void {
  const resolvedRoot = path.resolve(root);
  const files = serveStatic<ConsoleEnv>({
    root,
    onFound: (filePath: string, c: Context<ConsoleEnv>) => {
      c.set("routeLabel", "static");
      c.header(
        "Cache-Control",
        cacheControlFor(path.relative(resolvedRoot, path.resolve(filePath))),
      );
    },
  });
  app.use("/assets/*", files);
  app.all("/assets/*", (c) => c.notFound());
  app.get("*", files);
}

/** Any other GET renders `index.html`, so client routes survive a reload. */
export function mountSpaFallback(app: Hono<ConsoleEnv>, root: string): void {
  const indexPath = path.join(root, "index.html");
  app.get("*", async (c) => {
    const index = Bun.file(indexPath);
    if (!(await index.exists())) return c.notFound();
    c.set("routeLabel", "spa");
    return c.html(await index.text(), 200, { "Cache-Control": NO_CACHE });
  });
}
