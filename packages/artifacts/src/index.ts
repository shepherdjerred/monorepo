import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { BootstrapSchema, behaviorConfig } from "#infrastructure/config.ts";
import { createChangeHub } from "#infrastructure/change-hub.ts";
import { createDatabase } from "#infrastructure/database.ts";
import { logEvent } from "#infrastructure/log.ts";
import { createObjectStore } from "#infrastructure/object-store.ts";
import { startServer } from "#server/server.ts";

const config = BootstrapSchema.parse(Bun.env);
await initFeatureFlags({
  onInitializationFailure: (message) => {
    logEvent("artifacts_feature_flags_init_failed", { detail: message });
  },
});
const settings = behaviorConfig(config.ENVIRONMENT, {
  flagsDisabled: config.FEATURE_FLAGS_MODE === "disabled",
});
const operators = await settings.value("operatorLogins");
if (operators.length === 0) logEvent("artifacts_no_operator_logins");
const db = createDatabase(config.DATABASE_URL);
const hub = createChangeHub(config.DATABASE_URL);
const { server } = await startServer({
  config,
  db,
  store: createObjectStore(config),
  settings,
  hub,
});
// A database outage is retried in the background and never delays startup.
void hub.start();
logEvent("artifacts_listening", { port: server.port ?? 0 });

async function shutdown() {
  // Ends open streams, which would otherwise hold the graceful stop.
  await hub.stop();
  await server.stop();
  await db.$disconnect();
  await shutdownFeatureFlags();
}
process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
