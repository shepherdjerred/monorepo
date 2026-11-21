/**
 * `bun run dev:fixture` — the Media client on the Vite dev server, reading the
 * fixture API instead of a real Media server. Needs no Plex, PostgreSQL, or
 * Temporal. Runs in the foreground; Ctrl-C stops both listeners.
 *
 *   --port <n>        Vite port (default: a free port chosen at start)
 *   --persona <name>  owner (default) or member; MEDIA_FIXTURE_PERSONA also works
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { createServer } from "vite";
import { UserRoleSchema } from "#shared/contract.ts";
import { createFixtureApi } from "#testing/fixture-api/server.ts";

const LOOPBACK = "127.0.0.1";
const packageRoot = path.resolve(import.meta.dir, "..");

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!/^\d+$/u.test(value) || port < 1 || port > 65_535) {
    throw new Error(`--port must be a TCP port (1-65535), got "${value}"`);
  }
  return port;
}

/** Ask the OS for a port nothing is using, then release it for Vite. */
async function freePort(): Promise<number> {
  const probe = Bun.serve({
    hostname: LOOPBACK,
    port: 0,
    fetch: () => new Response(null, { status: 503 }),
  });
  const { port } = probe;
  await probe.stop(true);
  if (port === undefined) {
    throw new Error("The operating system did not assign a free port");
  }
  return port;
}

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: { type: "string" },
    // Accepted so `toolkit screenshot` can drive this like any Vite server;
    // the chosen port is always strict here.
    strictPort: { type: "boolean" },
    persona: { type: "string" },
  },
});

const persona = UserRoleSchema.parse(
  values.persona ?? Bun.env["MEDIA_FIXTURE_PERSONA"] ?? "owner",
);
const handle = createFixtureApi({
  defaultPersona: persona,
  log: (line) => {
    write(`fixture-api: ${line}`);
  },
});

// Port 0: the fixture API never competes with a real Media server on 7357.
const api = Bun.serve({
  hostname: LOOPBACK,
  port: 0,
  fetch: (request) =>
    handle(request) ?? new Response("Not found", { status: 404 }),
});
if (api.port === undefined) {
  throw new Error("The fixture API did not bind a port");
}
const apiOrigin = `http://${LOOPBACK}:${String(api.port)}`;

const port =
  values.port === undefined ? await freePort() : parsePort(values.port);
const vite = await createServer({
  root: packageRoot,
  configFile: path.join(packageRoot, "vite.config.ts"),
  // Overrides only this process: `vite` and `vite build` keep their defaults.
  server: { port, strictPort: true, proxy: { "/api": apiOrigin } },
});
await vite.listen();

write(`Media fixture mode: http://${LOOPBACK}:${String(port)}/`);
write(`  signed in as: ${persona}`);
write(`  fixture API:  ${apiOrigin}/api (read-only)`);
write(
  `  switch persona in a browser: /api/fixture/persona/${UserRoleSchema.options.join("|")}`,
);

async function shutdown(): Promise<never> {
  await vite.close();
  await api.stop(true);
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown();
  });
}
