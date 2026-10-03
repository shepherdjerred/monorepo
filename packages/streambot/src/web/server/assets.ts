import path from "node:path";
import { WebError } from "./errors.ts";

export async function serveWebAsset(
  url: URL,
  assetsDir: string,
): Promise<Response> {
  const root = path.resolve(assetsDir);
  const filePath = path.resolve(
    root,
    "." + (url.pathname === "/" ? "/index.html" : url.pathname),
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
