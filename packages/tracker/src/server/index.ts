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
import { createChangeHub } from "#infrastructure/change-hub.ts";
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
const changes = createChangeHub(config.DATABASE_URL);
// With the flag off no LISTEN connection opens; the stream route opens it
// on first use if the flag is turned on later. A database outage is retried
// in the background and never delays startup.
if (await behavior.value("liveUpdatesEnabled")) void changes.start();
const app = createApp({
  issues: new Issues(database, unit),
  collaboration: new Collaboration(database, unit),
  catalog: new Catalog(unit),
  attachments: new Attachments(database, unit, store),
  writesEnabled: () => behavior.value("writesEnabled"),
  attachmentMaxBytes: () => behavior.value("attachmentMaxBytes"),
  liveUpdatesEnabled: () => behavior.value("liveUpdatesEnabled"),
  changes,
});
const server = Bun.serve({
  // Matches the attachment upload route, which accepts 100 MiB files plus
  // multipart framing.
  maxRequestBodySize: 101 * 1024 * 1024,
  hostname: config.HOST,
  port: config.PORT,
  fetch: app.fetch,
});
console.warn(`Tracker listening on ${String(server.port)}`);
async function shutdown() {
  // Ends open event streams, which would otherwise hold the graceful stop.
  await changes.stop();
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
