import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { BootstrapSchema, behaviorConfig } from "#infrastructure/config.ts";
import { createDatabase } from "#infrastructure/database.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { createQualifier } from "#infrastructure/qualification.ts";
import { createRecoveryInspector } from "#infrastructure/recovery.ts";
import { createMinecraftRecoveryInspector } from "#infrastructure/minecraft-recovery/inspector.ts";
import {
  createForumBundleReader,
  createForumBundleVerifier,
} from "#infrastructure/forum/bundle-verifier.ts";
import { createForumBaselineInspector } from "#infrastructure/forum/baseline-inspector.ts";
import { createApp } from "./app.ts";
import { createTrmnlArchiveReader } from "@shepherdjerred/ops-clients/trmnl-archive.ts";
import { createTrmnlPluginClient } from "@shepherdjerred/ops-clients/trmnl.ts";
import { createTrmnlRecoveryInspector } from "#infrastructure/trmnl-recovery.ts";
import { createTrustedProxyAddresses } from "#infrastructure/ingress/proxy.ts";
import { createChangeListener } from "#infrastructure/change-feed/listener.ts";
import { createEnrichment } from "#infrastructure/enrichment/enrichment.ts";

const bootstrap = BootstrapSchema.parse(Bun.env);
await initFeatureFlags({
  onInitializationFailure: () => {
    console.warn("Delivery flags unavailable; safe defaults apply");
  },
});
const database = createDatabase(bootstrap.DATABASE_URL);
const delivery = new Delivery(database, bootstrap.WOODPECKER_REPO_ID);
const changeFeed = createChangeListener(bootstrap.DATABASE_URL);
void changeFeed.start();
const enrichment = createEnrichment({
  database,
  enabledSources: () =>
    behaviorConfig(bootstrap.ENVIRONMENT).value("enrichmentSources"),
  woodpecker: {
    origin: bootstrap.WOODPECKER_URL,
    repositoryId: bootstrap.WOODPECKER_REPO_ID,
    token: bootstrap.WOODPECKER_TOKEN,
  },
  github: {
    owner: "shepherdjerred",
    name: "monorepo",
    token: bootstrap.DELIVERY_GH_TOKEN,
  },
  argocd: {
    origin: bootstrap.ARGOCD_SERVER_URL,
    token: bootstrap.ARGOCD_RECOVERY_TOKEN,
  },
});
const inspectTrmnl =
  bootstrap.DELIVERY_TRMNL_S3_ACCESS_KEY_ID === undefined ||
  bootstrap.DELIVERY_TRMNL_S3_SECRET_ACCESS_KEY === undefined ||
  bootstrap.TRMNL_API_KEY === undefined
    ? undefined
    : createTrmnlRecoveryInspector({
        readArchive: createTrmnlArchiveReader({
          accessKeyId: bootstrap.DELIVERY_TRMNL_S3_ACCESS_KEY_ID,
          secretAccessKey: bootstrap.DELIVERY_TRMNL_S3_SECRET_ACCESS_KEY,
        }),
        client: createTrmnlPluginClient({ token: bootstrap.TRMNL_API_KEY }),
      });
const forumBundleReader =
  bootstrap.DELIVERY_FORUM_S3_ACCESS_KEY_ID === undefined ||
  bootstrap.DELIVERY_FORUM_S3_SECRET_ACCESS_KEY === undefined
    ? undefined
    : createForumBundleReader({
        endpoint: "https://seaweedfs-s3.tailnet-1a49.ts.net",
        accessKeyId: bootstrap.DELIVERY_FORUM_S3_ACCESS_KEY_ID,
        secretAccessKey: bootstrap.DELIVERY_FORUM_S3_SECRET_ACCESS_KEY,
      });
const app = createApp({
  delivery,
  changeFeed,
  enrichment,
  ...(forumBundleReader === undefined
    ? {}
    : { verifyForumBundle: createForumBundleVerifier(forumBundleReader) }),
  inspectForumBaseline: createForumBaselineInspector({
    argoOrigin: bootstrap.ARGOCD_SERVER_URL,
    argoToken: bootstrap.ARGOCD_RECOVERY_TOKEN,
    observationToken: bootstrap.DELIVERY_FORUM_OBSERVATION_TOKEN,
  }),
  ciOrigin: bootstrap.WOODPECKER_URL,
  ciRepositoryId: bootstrap.WOODPECKER_REPO_ID,
  qualifyBuild: createQualifier({
    origin: bootstrap.WOODPECKER_URL,
    repositoryId: bootstrap.WOODPECKER_REPO_ID,
    token: bootstrap.WOODPECKER_TOKEN,
  }),
  inspectRecovery: createRecoveryInspector({
    origin: bootstrap.ARGOCD_SERVER_URL,
    token: bootstrap.ARGOCD_RECOVERY_TOKEN,
    ...(inspectTrmnl === undefined ? {} : { inspectTrmnl }),
  }),
  inspectMinecraftRecovery: createMinecraftRecoveryInspector({
    controllerOrigin:
      "http://delivery-tsmc-controller.delivery-tsmc-controller.svc.cluster.local:7356",
    executorToken: bootstrap.DELIVERY_MACHINE_CREDENTIALS.find((credential) =>
      credential.principal.scopes.includes("execute"),
    )?.token,
    argoOrigin: bootstrap.ARGOCD_SERVER_URL,
    argoToken: bootstrap.ARGOCD_RECOVERY_TOKEN,
  }),
  config: {
    publicOrigin: bootstrap.PUBLIC_ORIGIN,
    machineCredentials: bootstrap.DELIVERY_MACHINE_CREDENTIALS,
    writesEnabled: () =>
      behaviorConfig(bootstrap.ENVIRONMENT).value("writesEnabled"),
    enabledEnvironments: () =>
      behaviorConfig(bootstrap.ENVIRONMENT).value("enabledEnvironments"),
    operatorLogins: () =>
      behaviorConfig(bootstrap.ENVIRONMENT).value("operatorLogins"),
    trustedProxyAddresses: createTrustedProxyAddresses(),
  },
  peerAddress: (request) => server.requestIP(request)?.address ?? null,
});
const server = Bun.serve({
  hostname: bootstrap.HOST,
  port: bootstrap.PORT,
  fetch: app.fetch,
});
console.warn(`Delivery listening on ${String(server.port)}`);
async function shutdown() {
  await server.stop();
  await changeFeed.stop();
  await database.$disconnect();
  await shutdownFeatureFlags();
}
process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
