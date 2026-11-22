/**
 * Browser-test harness, never a production entrypoint: the built client
 * bundle from `dist/` in front of the fixture API. It serves pages with the
 * real server's own security headers and client mount (hashed files under
 * `/assets/`, the web app manifest and its icons, the application shell
 * everywhere else) without Plex, PostgreSQL, or Temporal.
 */
import path from "node:path";
import { Hono } from "hono";
import { mountMediaClient } from "#server/static/client.ts";
import { mediaSecurityHeaders } from "#server/static/security-headers.ts";
import { createFixtureApi } from "#testing/fixture-api/server.ts";

const port = Number(Bun.argv[2] ?? Bun.env["MEDIA_E2E_PORT"]);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("MEDIA_E2E_PORT must be a valid TCP port");
}

const dist = path.resolve(import.meta.dir, "../../dist");
if (!(await Bun.file(path.join(dist, "index.html")).exists())) {
  throw new Error(`${dist} has no index.html; run \`bun run build\` first`);
}

const handle = createFixtureApi({
  defaultPersona: "owner",
  log: (line) => {
    process.stderr.write(`fixture-api: ${line}\n`);
  },
});

// The middleware the real server installs first: the browser enforces the
// production Content-Security-Policy on every page these tests open.
const app = new Hono();
app.use(mediaSecurityHeaders());
app.get("/readyz", (c) => c.json({ status: "ready" }));
app.all("/api/*", (c) => {
  const response = handle(c.req.raw);
  if (response === null) {
    throw new Error(`The fixture API did not answer ${c.req.path}`);
  }
  return response;
});
// And the mount it installs last, so a browser reads the manifest, the icons
// and the shell from the code that serves them in production.
mountMediaClient(app, dist);

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
