import { createTestDatabase } from "#testing/postgres.ts";
import { seedDelivery, testOperator } from "#testing/seed.ts";
import { workerFixture } from "#testing/worker-fixture.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { createApp } from "#server/app.ts";
import { testPublisher } from "#testing/seed.ts";
import { createHash } from "node:crypto";
import { seedMinecraftRecovery } from "./minecraft.ts";
import { seedBrowserForum } from "./forum.ts";
import { forumBundlePolicy } from "@shepherdjerred/ops-model/forum-bundle-policy.ts";
import { platformFixture } from "#testing/platform-fixture.ts";
import { seedPlatformBrowser } from "./platform.ts";
import {
  requestTestPlan,
  checkpointTestPlan,
  finishTestPlatform,
  testApply,
} from "#testing/platform-execution.ts";

// This executable is an isolated acceptance harness, never a production entrypoint.
const cluster = await createTestDatabase();
async function startHarness() {
  const delivery = new Delivery(cluster.database, 1, undefined, () =>
    Promise.resolve(forumBundlePolicy),
  );
  await seedDelivery(delivery);
  await seedBrowserForum(delivery);
  const scout = await workerFixture(delivery, "scout-prod");
  await scout.acceptedPool();
  const central = await workerFixture(delivery);
  await central.requestedBaseline();
  const chart = new TextEncoder().encode(
    "isolated browser upstream archive fixture",
  );
  const digest = `sha256:${createHash("sha256").update(chart).digest("hex")}`;
  const upstream = await delivery.acquireUpstreamArtifact(
    {
      requestId: "browser/upstream",
      serviceId: "minecraft",
      sourceRevision: "a".repeat(40),
      artifact: {
        id: "browser/upstream/minecraft",
        kind: "chart",
        component: "chart:minecraft",
        uri: "https://chartmuseum.sjer.red/charts/minecraft-4.0.0.tgz",
        version: "4.0.0",
        digest,
        origin: {
          kind: "upstream",
          repository: "https://itzg.github.io/minecraft-server-charts/",
          name: "minecraft",
          version: "4.0.0",
          checksum: digest,
        },
      },
    },
    testPublisher,
    (url) =>
      Promise.resolve(
        url.toString().endsWith("index.yaml")
          ? Response.json({
              entries: {
                minecraft: [
                  {
                    name: "minecraft",
                    version: "4.0.0",
                    digest: digest.slice(7),
                    urls: [
                      "https://github.com/itzg/minecraft-server-charts/releases/download/minecraft-4.0.0/minecraft-4.0.0.tgz",
                    ],
                  },
                ],
              },
            })
          : new Response(chart),
      ),
  );
  await seedMinecraftRecovery(delivery, upstream.artifact.id);
  const origin = "http://127.0.0.1:17353";
  const platform = await platformFixture(cluster.database);
  const plan = await requestTestPlan(
    platform.delivery,
    platform.sourceBuildId,
    "openai",
  );
  const saved = await checkpointTestPlan(platform.delivery, plan);
  await finishTestPlatform(platform.delivery, plan, saved);
  await testApply(platform.delivery, plan);
  await platform.delivery.createPlatformDeployment(
    {
      kind: "root-release",
      requestId: "browser/root",
      environmentId: platform.rootEnvironment.id,
      expectedGeneration: 0,
      sourceBuildId: platform.sourceBuildId,
    },
    testOperator,
  );
  await seedPlatformBrowser(
    cluster.database,
    platform.delivery,
    platform.sourceBuildId,
  );
  const app = createApp({
    // Every row is persisted through genuine publication, intent and evidence APIs.
    delivery: platform.delivery,
    ciOrigin: "https://woodpecker.sjer.red",
    ciRepositoryId: 1,
    qualifyBuild: () => Promise.resolve("verified"),
    peerAddress: (request) => backend.requestIP(request)?.address ?? null,
    config: {
      publicOrigin: origin,
      machineCredentials: [],
      writesEnabled: () => Promise.resolve(true),
      enabledEnvironments: () =>
        Promise.resolve([
          "arcade/prod",
          scout.environmentId,
          ...platform.environmentIds,
        ]),
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
  } catch (error) {
    await backend.stop(true);
    throw error;
  }
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
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
try {
  await startHarness();
} catch (error) {
  await cluster.close();
  throw error;
}
