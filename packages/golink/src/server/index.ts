import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { loadPlatformSites } from "#domain/platform-sites.ts";
import { BootstrapSchema, behaviorConfig } from "#infrastructure/config.ts";
import {
  createDatabase,
  createPrismaManualLinkRepository,
} from "#infrastructure/db.ts";
import { startK8sTailscaleDiscovery } from "#infrastructure/k8s-discovery.ts";
import {
  createGolinkMetrics,
  initializeTelemetry,
  shutdownTelemetry,
} from "#infrastructure/telemetry.ts";
import { createGolinkServer } from "./app.ts";

const config = BootstrapSchema.parse(Bun.env);
const flagsDisabled = config.FEATURE_FLAGS_MODE === "disabled";

await initFeatureFlags({
  onInitializationFailure: (message) => {
    console.warn(
      JSON.stringify({
        message: "golink_feature_flags_init_failed",
        detail: message,
      }),
    );
  },
});

const behavior = behaviorConfig(config.ENVIRONMENT, flagsDisabled);
initializeTelemetry(config, await behavior.value("telemetryEnabled"));

const database = createDatabase(config.DATABASE_URL);
const repo = createPrismaManualLinkRepository(database);

if (
  config.GOLINK_SEED_JSON !== undefined &&
  config.GOLINK_SEED_JSON.length > 0
) {
  const inserted = await repo.seedIfMissing(config.GOLINK_SEED_JSON);
  console.warn(
    JSON.stringify({
      message: "golink_seed_completed",
      inserted,
      configured: config.GOLINK_SEED_JSON.length,
    }),
  );
}

const [platformSites, discovery] = await Promise.all([
  loadPlatformSites(config.GOLINK_PLATFORM_MODEL_PATH),
  startK8sTailscaleDiscovery(),
]);

const server = createGolinkServer({
  repo,
  getIngressHosts: () => discovery.getHosts(),
  platformSites,
  tailnetDomain: config.TAILNET_DOMAIN,
  dynamicAliasesEnabled: () => behavior.value("dynamicAliasesEnabled"),
  writesEnabled: () => behavior.value("writesEnabled"),
  metrics: createGolinkMetrics(),
  hostname: config.HOST,
  port: config.PORT,
  onShutdown: async () => {
    discovery.stop();
    await repo.close();
    await shutdownFeatureFlags();
    await shutdownTelemetry();
  },
});

// Listens, and drains then closes everything above on SIGTERM or SIGINT.
server.start();
