import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { BootstrapSchema, behaviorConfig } from "#infrastructure/config.ts";
import { createDatabase } from "#infrastructure/database.ts";
import { Delivery } from "#infrastructure/delivery.ts";
import { createQualifier } from "#infrastructure/qualification.ts";
import { createRecoveryInspector } from "#infrastructure/recovery.ts";
import { createApp } from "./app.ts";

const bootstrap = BootstrapSchema.parse(Bun.env);
await initFeatureFlags({
  onInitializationFailure: () => {
    console.warn("Delivery flags unavailable; safe defaults apply");
  },
});
const database = createDatabase(bootstrap.DATABASE_URL);
const delivery = new Delivery(database);
const app = createApp({
  delivery,
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
    trustedProxyAddresses: () =>
      behaviorConfig(bootstrap.ENVIRONMENT).value("trustedProxyAddresses"),
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
  await database.$disconnect();
  await shutdownFeatureFlags();
}
process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
