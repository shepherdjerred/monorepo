/**
 * Browser-test harness, never a production entrypoint: the built client
 * bundle from `dist/` in front of the fixture API. It serves pages the way
 * the real server does (hashed files under `/assets/`, the application shell
 * everywhere else, and the same security headers on every response) without
 * Plex, PostgreSQL, or Temporal.
 */
import path from "node:path";
import { Hono } from "hono";
import { mediaSecurityHeaders } from "#server/static/security-headers.ts";
import { createFixtureApi } from "#testing/fixture-api/server.ts";

const port = Number(Bun.argv[2] ?? Bun.env["MEDIA_E2E_PORT"]);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("MEDIA_E2E_PORT must be a valid TCP port");
}

const dist = path.resolve(import.meta.dir, "../../dist");
const shell = Bun.file(path.join(dist, "index.html"));
if (!(await shell.exists())) {
  throw new Error(`${dist} has no index.html; run \`bun run build\` first`);
}

const handle = createFixtureApi({
  defaultPersona: "owner",
  log: (line) => {
    process.stderr.write(`fixture-api: ${line}\n`);
  },
});

async function asset(pathname: string): Promise<Response> {
  const file = path.resolve(dist, `.${decodeURIComponent(pathname)}`);
  if (!file.startsWith(`${dist}${path.sep}`)) {
    return new Response("Not found", { status: 404 });
  }
  const contents = Bun.file(file);
  return (await contents.exists())
    ? new Response(contents)
    : new Response("Not found", { status: 404 });
}

async function respond(request: Request): Promise<Response> {
  const api = handle(request);
  if (api !== null) {
    return api;
  }
  const { pathname } = new URL(request.url);
  if (pathname === "/readyz") {
    return Response.json({ status: "ready" });
  }
  return pathname.startsWith("/assets/")
    ? asset(pathname)
    : new Response(shell, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
}

// The middleware the real server installs first: the browser enforces the
// production Content-Security-Policy on every page these tests open.
const app = new Hono();
app.use(mediaSecurityHeaders());
app.all("*", async (c) => respond(c.req.raw));

const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: app.fetch });

async function shutdown(): Promise<never> {
  await server.stop(true);
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown();
  });
}
