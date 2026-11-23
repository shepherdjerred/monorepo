import path from "node:path";
import { z } from "zod";
import { recordedBuildDirectory } from "./recorded-build-directory.ts";
import {
  apiPath,
  contentPath,
  fetchRecordedBackend,
  readRecordedReplay,
  replayPath,
} from "./recorded-replay-data.ts";

const port = z.coerce
  .number()
  .int()
  .min(0)
  .max(65_535)
  .parse(Bun.argv[2] ?? "0");
const dist = recordedBuildDirectory();
const index = Bun.file(path.join(dist, "index.html"));
if (!(await index.exists())) {
  throw new Error(
    "Build the recorded replay app with e2e/public-replay/recorded-vite.config.ts first.",
  );
}
const fixture = await readRecordedReplay();
const staticPaths = new Map<string, string>();
for await (const relative of new Bun.Glob("**/*").scan({
  cwd: dist,
  onlyFiles: true,
})) {
  const urlPath = relative
    .replaceAll("\\", "/")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  staticPaths.set(`/app/${urlPath}`, relative);
  staticPaths.set(`/${urlPath}`, relative);
}

const responseHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "frame-ancestors 'none'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
};

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  development: false,
  async fetch(request, currentServer) {
    if (request.headers.get("host") !== currentServer.url.host)
      return new Response(null, { status: 403 });
    const { pathname } = new URL(request.url);
    if (
      pathname === "/trpc/auth.sessionState" &&
      (request.method === "GET" || request.method === "POST")
    ) {
      return Response.json([{ result: { data: { user: null } } }], {
        headers: responseHeaders,
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response(null, {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });

    async function file(localPath: string, type?: string) {
      const source = Bun.file(localPath);
      if (!(await source.exists())) return new Response(null, { status: 404 });
      return new Response(request.method === "HEAD" ? null : source, {
        headers: {
          ...responseHeaders,
          "Content-Length": source.size.toString(),
          "Content-Type": type ?? source.type,
        },
      });
    }

    switch (pathname) {
      case "/":
      case "/app/":
        return Response.redirect(new URL(replayPath, currentServer.url));
      case replayPath:
        return file(index.name ?? path.join(dist, "index.html"), "text/html");
      case "/api/version":
        return Response.json(
          { version: "0.0.1", gitSha: "recorded-preview", contractHash: "dev" },
          { headers: responseHeaders },
        );
      case apiPath:
        return Response.json(fixture.descriptor, { headers: responseHeaders });
      case `${apiPath}/timeline`:
        return (
          (await fetchRecordedBackend(pathname, request)) ??
          Response.json({ timeline: null }, { headers: responseHeaders })
        );
      case contentPath:
        return (
          (await fetchRecordedBackend(pathname, request)) ??
          file(fixture.roflPath, "application/vnd.riot.rofl")
        );
      case fixture.packageUrl:
        return file(fixture.manifestPath, "application/json");
    }
    const asset = fixture.paths.get(pathname);
    if (asset !== undefined) return file(path.join(fixture.root, asset));
    const appFile = staticPaths.get(pathname);
    return appFile === undefined
      ? new Response(null, { status: 404 })
      : file(path.join(dist, appFile));
  },
});

process.stdout.write(`${new URL(replayPath, server.url).href}\n`);
