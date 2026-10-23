import type { createTestDatabase } from "#testing/postgres.ts";
import { testOperator } from "#testing/seed.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { createApp } from "#server/app.ts";
import { createChangeListener } from "#infrastructure/change-feed/listener.ts";
import { fixtureEnrichment } from "#testing/enrichment-fixture.ts";
import type { MachineCredentialSchema } from "#infrastructure/config.ts";
import type { z } from "zod";

// An isolated acceptance harness, never a production entrypoint: the real
// Delivery app over a disposable database, behind a proxy that signs every
// request in as the test operator.

/**
 * Serve `delivery` on 127.0.0.1:`port` until SIGTERM or SIGINT, then stop
 * the change feed, the proxy, the app and the database.
 */
export async function serveHarness(options: {
  cluster: Awaited<ReturnType<typeof createTestDatabase>>;
  delivery: Delivery;
  port: number;
  enabledEnvironments: string[];
  /** Machine tokens the app accepts, so a CLI can drive admin and execute routes. */
  machineCredentials?: z.infer<typeof MachineCredentialSchema>[];
}) {
  const { cluster } = options;
  const origin = `http://127.0.0.1:${String(options.port)}`;
  const changeFeed = createChangeListener(cluster.url);
  await changeFeed.start();
  const app = createApp({
    // Every row is persisted through genuine publication, intent and evidence APIs.
    delivery: options.delivery,
    changeFeed,
    enrichment: fixtureEnrichment(cluster.database),
    ciOrigin: "https://woodpecker.sjer.red",
    ciRepositoryId: 1,
    qualifyBuild: () => Promise.resolve("verified"),
    peerAddress: (request) => backend.requestIP(request)?.address ?? null,
    config: {
      publicOrigin: origin,
      machineCredentials: options.machineCredentials ?? [],
      writesEnabled: () => Promise.resolve(true),
      enabledEnvironments: () => Promise.resolve(options.enabledEnvironments),
      operatorLogins: () => Promise.resolve([testOperator.id]),
      trustedProxyAddresses: () => Promise.resolve(["127.0.0.1"]),
    },
  });
  const backend = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: app.fetch,
  });
  let proxy: typeof backend;
  try {
    proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: options.port,
      fetch: async (request) => {
        const incoming = new URL(request.url);
        const target = new URL(
          `${incoming.pathname}${incoming.search}`,
          backend.url,
        );
        const headers = new Headers(request.headers);
        headers.delete("tailscale-user-login");
        // A configured machine token passes through; every other request
        // signs in as the test operator.
        if (
          (options.machineCredentials ?? []).length === 0 ||
          !headers.has("authorization")
        ) {
          headers.delete("authorization");
          headers.set("tailscale-user-login", testOperator.id);
        }
        return fetch(
          new Request(target, {
            method: request.method,
            headers,
            ...(["GET", "HEAD"].includes(request.method)
              ? {}
              : { body: await request.arrayBuffer() }),
          }),
          { redirect: "manual" },
        );
      },
    });
  } catch (error) {
    await backend.stop(true);
    throw error;
  }
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await changeFeed.stop();
    await cluster.close();
    await proxy.stop(true);
    await backend.stop(true);
    process.exitCode = 0;
  }
  process.on("SIGTERM", () => {
    void close();
  });
  process.on("SIGINT", () => {
    void close();
  });
  console.warn(`Delivery isolated browser harness ready: ${origin}`);
}
