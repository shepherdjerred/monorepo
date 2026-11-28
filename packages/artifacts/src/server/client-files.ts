import path from "node:path";

const BUILT_CLIENT = new URL("../../dist/client", import.meta.url).pathname;

const PLACEHOLDER = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Artifacts</title></head>
<body><h1>Artifacts</h1><p>The review UI is not built into this image.</p></body>
</html>
`;

/**
 * Static files of the built UI. A path that names a file serves it; any other
 * GET is the single-page app's `index.html`. A placeholder stands in until
 * the UI exists. Paths are decoded once and must stay inside the root.
 */
export async function serveClient(
  urlPath: string,
  root: string = BUILT_CLIENT,
): Promise<Response> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const file = path.normalize(path.join(root, decoded));
  const inside = file === root || file.startsWith(`${root}/`);
  if (inside && decoded !== "/") {
    const candidate = Bun.file(file);
    if (await candidate.exists()) {
      const immutable = decoded.startsWith("/assets/");
      return new Response(candidate, {
        headers: {
          "Cache-Control": immutable
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        },
      });
    }
    if (decoded.startsWith("/assets/"))
      return Response.json({ error: "Not found" }, { status: 404 });
  }
  const index = Bun.file(path.join(root, "index.html"));
  return (await index.exists())
    ? new Response(index, { headers: { "Cache-Control": "no-cache" } })
    : new Response(PLACEHOLDER, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
}
