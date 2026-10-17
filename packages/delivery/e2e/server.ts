import { createTestDatabase } from "#testing/postgres.ts";
import {
  seedDelivery,
  testExecutor,
  testOperator,
  testPublisher,
} from "#testing/seed.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { createApp } from "#server/app.ts";

// This executable is an isolated acceptance harness, never a production entrypoint.
const cluster = await createTestDatabase();
const delivery = new Delivery(cluster.database);
await seedDelivery(delivery);
const scoutBuild = await delivery.publish(
  {
    requestId: "browser-scout-build",
    serviceId: "scout-for-lol",
    sourceRevision: "a".repeat(40),
    ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/2",
    verifiedAt: new Date().toISOString(),
    artifacts: [
      {
        id: "browser-scout-image",
        component: "server",
        kind: "image",
        uri: "docker.io/shepherdjerred/scout-for-lol",
        digest: `sha256:${"c".repeat(64)}`,
        version: "1.0.0",
      },
      {
        id: "browser-scout-chart",
        component: "chart",
        kind: "chart",
        uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/scout-1.0.0.tgz",
        digest: `sha256:${"d".repeat(64)}`,
        version: "1.0.0",
      },
    ],
  },
  testPublisher,
  { repositoryId: 1, pipelineNumber: 2 },
);
await delivery.qualify(scoutBuild.buildId, "verified", testExecutor);
await delivery.registerPipeline(
  "browser-scout/1",
  {
    kind: "argocd",
    application: "scout-prod",
    chartRepository: "https://chartmuseum.tailnet-1a49.ts.net",
    chartName: "scout",
    chartComponent: "chart",
    parameters: {},
    artifactParameters: { "image.ref": "server" },
  },
  testOperator,
);
await delivery.registerEnvironment(
  {
    id: "scout/prod",
    serviceId: "scout-for-lol",
    name: "production",
    application: "scout-prod",
    pipelineRevisionId: "browser-scout/1",
    configurationRevision: "config/1",
    configuration: {},
    automatic: false,
  },
  testOperator,
);
const origin = "http://127.0.0.1:17353";
const app = createApp({
  delivery,
  ciOrigin: "https://woodpecker.sjer.red",
  ciRepositoryId: 1,
  qualifyBuild: () => Promise.resolve("verified"),
  peerAddress: (request) => backend.requestIP(request)?.address ?? null,
  config: {
    publicOrigin: origin,
    machineCredentials: [],
    writesEnabled: () => Promise.resolve(true),
    enabledEnvironments: () => Promise.resolve(["arcade/prod", "scout/prod"]),
    operatorLogins: () => Promise.resolve([testOperator.id]),
    trustedProxyAddresses: () => Promise.resolve(["127.0.0.1"]),
  },
});
const backend = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
const proxy = Bun.serve({
  hostname: "127.0.0.1",
  port: 17_353,
  fetch: async (request) => {
    const incoming = new URL(request.url);
    const target = new URL(
      `${incoming.pathname}${incoming.search}`,
      backend.url,
    );
    const headers = new Headers(request.headers);
    headers.delete("tailscale-user-login");
    headers.delete("authorization");
    headers.set("tailscale-user-login", testOperator.id);
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
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await proxy.stop(true);
  await backend.stop(true);
  await cluster.close();
  process.exitCode = 0;
}
process.on("SIGTERM", () => {
  void close();
});
process.on("SIGINT", () => {
  void close();
});
console.warn(`Delivery isolated browser harness ready: ${origin}`);
