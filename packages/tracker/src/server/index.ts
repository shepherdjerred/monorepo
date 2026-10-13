import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { BootstrapSchema, behaviorConfig } from "#infrastructure/config.ts";
import { createDatabase } from "#infrastructure/database.ts";
import { PrismaUnitOfWork } from "#infrastructure/prisma-unit-of-work.ts";
import { Issues } from "#infrastructure/issues.ts";
import { Collaboration } from "#infrastructure/collaboration.ts";
import { Catalog } from "#infrastructure/catalog.ts";
import { Attachments } from "#infrastructure/attachments.ts";
import { createObjectStore } from "#infrastructure/object-store.ts";
import { Importer } from "#infrastructure/importer.ts";
import {
  initializeObservability,
  shutdownObservability,
} from "#infrastructure/observability.ts";
import { createApp } from "./app.ts";

const config = BootstrapSchema.parse(Bun.env);
await initFeatureFlags({
  onInitializationFailure: (message) => {
    console.warn(message);
  },
});
const behavior = behaviorConfig(config.ENVIRONMENT);
initializeObservability(config, await behavior.value("telemetryEnabled"));
const database = createDatabase(config.DATABASE_URL);
const unit = new PrismaUnitOfWork(database);
const store = createObjectStore(config);
const app = createApp({
  issues: new Issues(database, unit),
  collaboration: new Collaboration(database, unit),
  catalog: new Catalog(unit),
  attachments: new Attachments(database, unit, store),
  importer: new Importer(database, store),
  importsEnabled: () => behavior.value("importsEnabled"),
  writesEnabled: () => behavior.value("writesEnabled"),
  attachmentMaxBytes: () => behavior.value("attachmentMaxBytes"),
});
const server = Bun.serve({
  hostname: config.HOST,
  port: config.PORT,
  fetch: app.fetch,
});
console.warn(`Tracker listening on ${String(server.port)}`);
async function shutdown() {
  await server.stop();
  await database.$disconnect();
  await shutdownFeatureFlags();
  await shutdownObservability();
}
process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
