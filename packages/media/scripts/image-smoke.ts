import { startMediaTestPostgres } from "#testing/postgres.ts";

const database = await startMediaTestPostgres();
const probe = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response(),
});
const port = probe.port;
await probe.stop(true);
const origin = `http://127.0.0.1:${String(port)}`;
const server = Bun.spawn(["bun", "src/server/index.ts"], {
  cwd: `${import.meta.dir}/..`,
  env: {
    PATH: Bun.env["PATH"],
    HOME: Bun.env["HOME"],
    DATABASE_URL: database.url,
    MEDIA_CREDENTIAL_KEY: Buffer.alloc(32, 1).toString("base64"),
    PLEX_SERVER_MACHINE_ID: "image-smoke-server",
    PLEX_OWNER_ACCOUNT_ID: "image-smoke-owner",
    TMDB_TOKEN: "image-smoke-placeholder",
    PUBLIC_ORIGIN: origin,
    HOST: "127.0.0.1",
    PORT: String(port),
    ENVIRONMENT: "test",
    FEATURE_FLAGS_MODE: "disabled",
    TEMPORAL_ADDRESS: "127.0.0.1:17233",
    TEMPORAL_NAMESPACE: "dev",
  },
  stdout: "pipe",
  stderr: "pipe",
});
const output = new Response(server.stdout).text();
const errors = new Response(server.stderr).text();

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null)
      throw new Error("Media API exited before becoming ready");
    try {
      const health = await fetch(`${origin}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      ready = health.ok;
    } catch {
      // Connection refusal is expected while the real process initializes.
    }
    if (ready) break;
    await Bun.sleep(100);
  }
  if (!ready) throw new Error("Media API did not become ready");
  for (const route of ["/", "/requests", "/removals"]) {
    const page = await fetch(new URL(route, origin));
    const html = await page.text();
    if (!page.ok || !html.includes('id="root"'))
      throw new Error(`Media client route ${route} was not served`);
    const asset = /src="([^"]+\.js)"/u.exec(html)?.[1];
    if (asset === undefined)
      throw new Error("Media client asset was not declared");
    const assetResponse = await fetch(new URL(asset, origin));
    if (!assetResponse.ok) throw new Error("Media client asset was not served");
  }
  const anonymous = await fetch(`${origin}/api/v1/me`);
  if (anonymous.status !== 401)
    throw new Error("Media API did not require authentication");
  process.stdout.write(
    "Media runtime smoke: migrated PostgreSQL, API, client routes, assets, and authentication boundary passed\n",
  );
} finally {
  server.kill("SIGTERM");
  await server.exited;
  const diagnostics = `${await output}\n${await errors}`.trim();
  if (diagnostics.length > 0) console.error(diagnostics);
  await database.close();
}
