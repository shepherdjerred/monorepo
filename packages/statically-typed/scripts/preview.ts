import { distRoot } from "./build.ts";

export async function startPreview(root: URL = distRoot, port = 4326) {
  const routes = new Map<string, URL>(
    [
      "index.html",
      "404.html",
      "styles.css",
      "fonts/BerkeleyMono-Regular.woff2",
    ].map((path) => [`/${path}`, new URL(path, root)] as const),
  );
  for (const file of routes.values()) {
    if (!(await Bun.file(file).exists())) {
      throw new Error("Build the site before starting its preview");
    }
  }
  const index = routes.get("/index.html");
  const notFound = routes.get("/404.html");
  if (index === undefined || notFound === undefined) {
    throw new Error("Preview documents are missing");
  }
  routes.set("/", index);

  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(request) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response(null, {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        });
      }
      const file = routes.get(new URL(request.url).pathname);
      // A fresh BunFile observes replaced build output rather than caching its
      // previous length across a rebuild.
      return new Response(Bun.file(file ?? notFound), {
        status: file === undefined ? 404 : 200,
        headers: { "Cache-Control": "no-cache" },
      });
    },
  });
}

if (import.meta.main) {
  const server = await startPreview();
  process.stdout.write(`Statically Typed preview: ${String(server.url)}\n`);
}
