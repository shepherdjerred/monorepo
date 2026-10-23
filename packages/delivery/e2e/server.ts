import { createTestDatabase } from "#testing/postgres.ts";
import { seedDelivery } from "#testing/seed.ts";
import { workerFixture } from "#testing/worker-fixture.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { testPublisher } from "#testing/seed.ts";
import { declareAcquisitions } from "#testing/services.ts";
import { createHash } from "node:crypto";
import { seedMinecraftRecovery } from "./minecraft.ts";
import { seedBrowserForum } from "#testing/browser-forum.ts";
import { seedContentRecovery } from "#testing/browser-content-recovery.ts";
import { forumBundlePolicy } from "@shepherdjerred/ops-model/forum-bundle-policy.ts";
import { platformFixture } from "#testing/platform-fixture.ts";
import { seedPlatformBrowser } from "./platform.ts";
import { serveHarness } from "./harness.ts";
import {
  requestTestPlan,
  checkpointTestPlan,
  finishTestPlatform,
  testApply,
} from "#testing/platform-execution.ts";
import { VersionCatalogEntrySchema } from "@shepherdjerred/version-catalog";

// This executable is an isolated acceptance harness, never a production entrypoint.
const cluster = await createTestDatabase();
async function startHarness() {
  const delivery = new Delivery(cluster.database, 1, undefined, () =>
    Promise.resolve(forumBundlePolicy),
  );
  await seedDelivery(delivery);
  const forum = await seedBrowserForum(delivery);
  await seedContentRecovery(delivery, forum.id);
  const scout = await workerFixture(delivery, "scout-prod");
  await scout.acceptedPool();
  const central = await workerFixture(delivery);
  await central.requestedBaseline();
  // The catalog document names the Minecraft chart's acquiring service.
  await declareAcquisitions(cluster.database, "minecraft", ["chart:minecraft"]);
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
    {
      transport: (url) =>
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
      // The harness pins its own fixture version instead of the live catalog's.
      components: [
        VersionCatalogEntrySchema.parse({
          name: "minecraft",
          category: "upstream",
          artifactType: "helm-chart",
          management: {
            managed: true,
            datasource: "helm",
            registryUrl: "https://itzg.github.io/minecraft-server-charts",
            versioning: "semver",
          },
          value: "4.0.0",
          component: true,
        }),
      ],
    },
  );
  await seedMinecraftRecovery(delivery, upstream.artifact.id);
  const platform = await platformFixture(cluster.database);
  const plan = await requestTestPlan(
    platform.delivery,
    platform.sourceBuildId,
    "openai",
  );
  const saved = await checkpointTestPlan(platform.delivery, plan);
  await finishTestPlatform(platform.delivery, plan, saved);
  await testApply(platform.delivery, plan);
  await seedPlatformBrowser(
    cluster.database,
    platform.delivery,
    platform.sourceBuildId,
  );
  await serveHarness({
    cluster,
    delivery: platform.delivery,
    port: 17_353,
    enabledEnvironments: [
      "arcade/prod",
      scout.environmentId,
      ...platform.environmentIds,
    ],
  });
}
try {
  await startHarness();
} catch (error) {
  await cluster.close();
  throw error;
}
