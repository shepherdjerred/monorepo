import type { Env, Hono } from "hono";
import { serveStatic } from "hono/bun";
import { etag } from "hono/etag";

/**
 * Vite names every file under `assets/` after its content hash, so a URL never
 * changes meaning and a browser may keep its copy for a year without asking.
 */
export const HASHED_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * The web app manifest and the icons it names keep one address for good: an
 * installed app, a home-screen icon and a bookmark all hold it, and Vite
 * rewrites no URL inside a manifest. A browser may keep a copy but asks before
 * each use, and the entity tag turns an unchanged file into an empty `304`.
 */
export const WEB_APP_FILE_CACHE_CONTROL = "no-cache";

/** Where Vite copies `public/`: the manifest, and the directory of icons. */
const WEB_APP_FILES = ["/manifest.webmanifest", "/icons/*"] as const;

function isWebAppFile(path: string): boolean {
  return path === "/manifest.webmanifest" || path.startsWith("/icons/");
}

/**
 * Serves the built browser client from `root`. Register it after every other
 * GET route: the final handler answers any path outside `/api`, `/assets` and
 * the web app's files with the application shell.
 *
 * Only a file that exists is cacheable: a hashed asset for good, the manifest
 * and icons until they change. A missing file, the shell and every API
 * response keep the `no-store` the application sets on all responses, because
 * the shell is what points a browser at a new release.
 *
 * None of this sits behind the session: a browser fetches a manifest without
 * cookies, and the sign-in page needs its icons.
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
  for (const files of WEB_APP_FILES) {
    app.get(
      files,
      etag(),
      serveStatic({
        root,
        onFound: (_path, c) => {
          c.header("Cache-Control", WEB_APP_FILE_CACHE_CONTROL);
        },
      }),
    );
  }
  app.get("*", async (c, next) => {
    return c.req.path === "/api" ||
      c.req.path.startsWith("/api/") ||
      c.req.path.startsWith("/assets/") ||
      isWebAppFile(c.req.path)
      ? next()
      : serveStatic({ root, path: "index.html" })(c, next);
  });
}
