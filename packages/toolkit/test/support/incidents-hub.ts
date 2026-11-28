/**
 * Hub's incidents module served for real over HTTP, the way Hub mounts it
 * (`/api/incidents/trpc` plus the REST routes), over the package's seeded
 * in-memory fixture. Tests share one clock between the server and the CLI.
 *
 * Run directly for demos: `bun test/support/incidents-hub.ts --port 7400
 * --grace-seconds 5 --lease-seconds 30` prints the base URL and serves until
 * killed.
 */
import { parseArgs } from "node:util";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import {
  createIncidentsFixtureHubServer,
  type IncidentsFixtureOptions,
  type IncidentsHubServer,
} from "@shepherdjerred/incidents/hub-server";

type FlagReader = NonNullable<IncidentsFixtureOptions["flags"]>;
export type IncidentsTestSettings = Awaited<ReturnType<FlagReader["read"]>>;

export const DEFAULT_TEST_SETTINGS: IncidentsTestSettings = {
  enabled: true,
  autoOpenAlertmanager: true,
  autoOpenMainCi: true,
  takeoverGraceSeconds: 600,
  dispatchLeaseSeconds: 600,
  takeoverSpawnEnabled: true,
  takeoverProvider: "claude-code",
};

export type IncidentsHub = {
  readonly url: string;
  readonly module: IncidentsHubServer;
  /** Change flags at runtime; read on every call, like Hub's flag client. */
  readonly settings: { current: IncidentsTestSettings };
  readonly stop: () => Promise<void>;
};

export async function serveIncidentsHub(
  options: {
    clock?: () => Date;
    settings?: Partial<IncidentsTestSettings>;
    port?: number;
    heartbeatMs?: number;
  } = {},
): Promise<IncidentsHub> {
  const settings = {
    current: { ...DEFAULT_TEST_SETTINGS, ...options.settings },
  };
  const module = await createIncidentsFixtureHubServer({
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    flags: { read: () => Promise.resolve(settings.current) },
    heartbeatMs: options.heartbeatMs ?? 2000,
    publicOrigin: "https://hub.example.ts.net",
  });
  const app = new Hono();
  app.all("/api/incidents/trpc/*", (context) =>
    fetchRequestHandler({
      endpoint: "/api/incidents/trpc",
      req: context.req.raw,
      router: module.trpc.router,
      createContext: ({ req }) => module.trpc.createContext(req),
    }),
  );
  const routes = new Hono();
  module.register(routes);
  app.route("/api/incidents", routes);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    fetch: app.fetch,
  });
  return {
    url: server.url.toString().replace(/\/$/u, ""),
    module,
    settings,
    stop: async () => {
      await server.stop(true);
    },
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      port: { type: "string", default: "0" },
      "grace-seconds": { type: "string", default: "600" },
      "lease-seconds": { type: "string", default: "600" },
    },
  });
  const hub = await serveIncidentsHub({
    port: Number(values.port),
    settings: {
      takeoverGraceSeconds: Number(values["grace-seconds"]),
      dispatchLeaseSeconds: Number(values["lease-seconds"]),
    },
  });
  console.log(hub.url);
}
