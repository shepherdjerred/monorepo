import path from "node:path";
import { WebError } from "./errors.ts";

/** Client-side routes of the remote; anything else without a file extension is a 404. */
const CLIENT_ROUTES = [
  "/",
  "/library",
  "/playlists",
  "/live",
  "/history",
  "/album",
  "/artist",
  // Discord's player cards and tips link here (`src/discord/web-link.ts`); the remote opens Home.
  "/music",
  "/plex",
];

/**
 * The HTML page that owns a browser path: the remote's page, or `null` for a file path. The Vite
 * dev server uses the same mapping.
 */
export function webPage(pathname: string): string | null {
  return CLIENT_ROUTES.some(
    (route) =>
      pathname === route || (route !== "/" && pathname.startsWith(route + "/")),
  )
    ? "/client/index.html"
    : null;
}

export async function serveWebAsset(
  url: URL,
  assetsDir: string,
): Promise<Response> {
  const root = path.resolve(assetsDir);
  const filePath = path.resolve(
    root,
    "." + (webPage(url.pathname) ?? url.pathname),
  );
  if (!filePath.startsWith(root + path.sep))
    throw new WebError(404, "not_found", "This page does not exist.");
  const file = Bun.file(filePath);
  if (!(await file.exists()))
    throw new WebError(404, "not_found", "This page does not exist.");
  return new Response(file, {
    headers: {
      "cache-control": url.pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    },
  });
}
