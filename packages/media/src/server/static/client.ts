import type { Env, Hono } from "hono";
import { serveStatic } from "hono/bun";

/**
 * Vite names every file under `assets/` after its content hash, so a URL never
 * changes meaning and a browser may keep its copy for a year without asking.
 */
export const HASHED_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Serves the built browser client from `root`. Register it after every other
 * GET route: the final handler answers any path outside `/api` and `/assets`
 * with the application shell.
 *
 * Only a hashed asset that exists is cacheable. A missing asset, the shell and
 * every API response keep the `no-store` the application sets on all
 * responses, because the shell is what points a browser at a new release.
 */
export function mountMediaClient<E extends Env>(
  app: Hono<E>,
  root: string,
): void {
  app.get(
    "/assets/*",
    serveStatic({
      root,
      onFound: (_path, c) => {
        c.header("Cache-Control", HASHED_ASSET_CACHE_CONTROL);
      },
    }),
  );
  app.get("*", async (c, next) => {
    return c.req.path === "/api" ||
      c.req.path.startsWith("/api/") ||
      c.req.path.startsWith("/assets/")
      ? next()
      : serveStatic({ root, path: "index.html" })(c, next);
  });
}
