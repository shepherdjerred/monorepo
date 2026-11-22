import { chown, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

const packageRoot = `${import.meta.dir}/..`;
const WebAppManifestSchema = z.object({
  icons: z.array(z.object({ src: z.string() })).min(1),
});

function runSmokeCommand(
  args: string[],
  environment: Record<string, string | undefined> = {},
): string {
  const result = Bun.spawnSync(args, {
    cwd: packageRoot,
    env: { ...Bun.env, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `${args[0] ?? "Command"} failed: ${result.stderr.toString()}`,
    );
  }
  return result.stdout.toString().trim();
}

function postgresSmokeCommand(args: string[]): string[] {
  if (process.getuid?.() !== 0) return args;
  const command = args[0];
  if (command === undefined) throw new Error("PostgreSQL command missing");
  const resolved = Bun.which(command) ?? command;
  return ["runuser", "-u", "nobody", "--", resolved, ...args.slice(1)];
}

async function allocateEphemeralPort(): Promise<number> {
  const probe = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(),
  });
  const allocated = probe.port;
  await probe.stop(true);
  if (allocated === undefined) {
    throw new Error("Failed to allocate ephemeral port");
  }
  return allocated;
}

async function startDisposableSmokePostgres(): Promise<{
  readonly url: string;
  readonly close: () => Promise<void>;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "media-smoke-pg-"));
  if (process.getuid?.() === 0) await chown(directory, 65_534, 65_534);
  const pgPort = await allocateEphemeralPort();
  const data = path.join(directory, "data");
  let started = false;
  const close = async () => {
    if (started) {
      runSmokeCommand(
        postgresSmokeCommand([
          "pg_ctl",
          "-D",
          data,
          "-m",
          "fast",
          "-w",
          "stop",
        ]),
      );
    }
    await rm(directory, { recursive: true, force: true });
  };
  try {
    runSmokeCommand(
      postgresSmokeCommand([
        "initdb",
        "-D",
        data,
        "-U",
        "media",
        "-A",
        "trust",
        "--no-locale",
        "--encoding=UTF8",
      ]),
    );
    runSmokeCommand(
      postgresSmokeCommand([
        "pg_ctl",
        "-D",
        data,
        "-l",
        path.join(directory, "server.log"),
        "-o",
        `-h 127.0.0.1 -p ${String(pgPort)} -k ${directory}`,
        "-w",
        "start",
      ]),
    );
    started = true;
    const url = `postgres://media@127.0.0.1:${String(pgPort)}/postgres`;
    runSmokeCommand(["bun", "run", "migrate:deploy"], { DATABASE_URL: url });
    return { url, close };
  } catch (error) {
    await close();
    throw error;
  }
}

const database = await startDisposableSmokePostgres();
const port = await allocateEphemeralPort();
const origin = `http://127.0.0.1:${String(port)}`;
const server = Bun.spawn(["bun", "src/server/index.ts"], {
  cwd: packageRoot,
  env: {
    PATH: Bun.env["PATH"],
    HOME: Bun.env["HOME"],
    DATABASE_URL: database.url,
    MEDIA_CREDENTIAL_KEY: Buffer.alloc(32, 1).toString("base64"),
    PLEX_SERVER_MACHINE_ID: "image-smoke-server",
    PLEX_SERVER_URL: "http://127.0.0.1:32400",
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
  // The installable web app: the manifest and every icon it names, which the
  // image holds only if the build copied `public/` into `dist/`.
  const manifest = await fetch(new URL("/manifest.webmanifest", origin));
  if (
    !manifest.ok ||
    manifest.headers.get("Content-Type") !== "application/manifest+json"
  )
    throw new Error("Media web app manifest was not served");
  const { icons } = WebAppManifestSchema.parse(await manifest.json());
  for (const { src } of icons) {
    const icon = await fetch(new URL(src, origin));
    if (!icon.ok || icon.headers.get("Content-Type") !== "image/png")
      throw new Error(`Media web app icon ${src} was not served`);
  }
  const anonymous = await fetch(`${origin}/api/v1/me`);
  if (anonymous.status !== 401)
    throw new Error("Media API did not require authentication");
  process.stdout.write(
    "Media runtime smoke: migrated PostgreSQL, API, client routes, assets, web app manifest and icons, and authentication boundary passed\n",
  );
} finally {
  server.kill("SIGTERM");
  await server.exited;
  const diagnostics = `${await output}\n${await errors}`.trim();
  if (diagnostics.length > 0) console.error(diagnostics);
  await database.close();
}
