import path from "node:path";
import { WebError } from "./errors.ts";

/** Client-side routes of the current remote; anything else without a file extension is a 404. */
const CLIENT_ROUTES = [
  "/",
  "/library",
  "/playlists",
  "/live",
  "/history",
  "/album",
  "/artist",
  // Bookmarks from the classic remote land on the new Home instead of a 404.
  "/music",
  "/plex",
  "/search",
  "/sports",
];

/**
 * The HTML page that owns a browser path: the current remote, the classic remote under
 * `/classic`, or `null` for a file path. The Vite dev server uses the same mapping.
 */
export function webPage(pathname: string): string | null {
  if (pathname === "/classic" || pathname.startsWith("/classic/"))
    return "/client-classic/index.html";
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
