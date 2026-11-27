/**
 * Boots the fake service on two loopback listeners: the app origin (SPA,
 * `/trpc`, `/api`) and the content origin on an ephemeral port. Different
 * ports make different origins, which is all the sandbox needs here.
 */
import path from "node:path";
import { createFakeService, type FakeService } from "./fake-service.ts";
import type { FakeServiceOptions } from "./fake-types.ts";

const CLIENT_DIST = path.resolve(import.meta.dir, "../dist/client");

const PLACEHOLDER_INDEX = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Artifacts (placeholder)</title></head>
  <body><main><h1>Artifacts</h1><p>dist/client/index.html is missing; run the Vite build.</p></main></body>
</html>
`;

export type E2eServer = {
  readonly appOrigin: string;
  readonly contentOrigin: string;
  readonly service: FakeService;
  readonly stop: () => Promise<void>;
};

/**
 * The Content-Security-Policy the app host is expected to send, so the e2e
 * proves the UI works under it: the content origin may supply images, media,
 * fetches and frames, and nothing else leaves the app origin.
 */
export function appPolicy(contentOrigin: string): string {
  return [
    "default-src 'self'",
    // The terminal player compiles a WebAssembly module.
    "script-src 'self' 'wasm-unsafe-eval'",
    `img-src 'self' data: blob: ${contentOrigin}`,
    `media-src ${contentOrigin} blob:`,
    `connect-src 'self' ${contentOrigin}`,
    `frame-src ${contentOrigin}`,
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "frame-ancestors 'none'",
  ].join("; ");
}

async function serveStatic(
  pathname: string,
  contentOrigin: string,
): Promise<Response> {
  const root = CLIENT_DIST;
  const candidate = path.join(root, decodeURIComponent(pathname));
  if (candidate.startsWith(root + path.sep)) {
    const file = Bun.file(candidate);
    if (await file.exists()) return new Response(file);
  }
  if (pathname.startsWith("/assets/") || path.extname(pathname) !== "")
    return new Response("not found", { status: 404 });
  const index = Bun.file(path.join(root, "index.html"));
  return new Response((await index.exists()) ? index : PLACEHOLDER_INDEX, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": appPolicy(contentOrigin),
    },
  });
}

/** Settling is off by default so a specs' comment is claimable at once. */
export function startE2eServer(
  appPort: number,
  options?: FakeServiceOptions,
): E2eServer {
  const service = createFakeService(options ?? { settleMs: 0 });
  const content = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => service.contentFetch(request),
  });
  const app = Bun.serve({
    hostname: "127.0.0.1",
    port: appPort,
    // Streams stay open; the heartbeat keeps them alive but never rely on it.
    idleTimeout: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === "/readyz" || pathname === "/healthz")
        return new Response("ok");
      if (pathname.startsWith("/_"))
        return new Response("not found", { status: 404 });
      const served = await service.appFetch(request);
      if (served !== null) return served;
      return request.method === "GET" || request.method === "HEAD"
        ? serveStatic(pathname, `http://127.0.0.1:${String(content.port)}`)
        : new Response("method not allowed", { status: 405 });
    },
  });
  const appOrigin = `http://127.0.0.1:${String(app.port)}`;
  const contentOrigin = `http://127.0.0.1:${String(content.port)}`;
  service.configure({ app: appOrigin, content: contentOrigin });
  return {
    appOrigin,
    contentOrigin,
    service,
    async stop() {
      await app.stop(true);
      await content.stop(true);
    },
  };
}
