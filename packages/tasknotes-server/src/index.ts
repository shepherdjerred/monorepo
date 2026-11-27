import "./bugsink.ts";

import { createFacetApp } from "./app.ts";
import { config } from "./config.ts";
import { getDatabase } from "./infrastructure/database.ts";
import { tasksTotal, uptimeSeconds } from "./metrics.ts";
import { InMemoryFacetStore } from "./v1/stores/in-memory-store.ts";
import { PrismaFacetStore } from "./v1/stores/prisma-store.ts";
import { requireWebRoot, webIndexExists, webRootPath } from "./web-ui.ts";

const hasDatabaseUrl =
  Bun.env["DATABASE_URL"] !== undefined && Bun.env["DATABASE_URL"] !== "";
const v1Store = hasDatabaseUrl
  ? new PrismaFacetStore(getDatabase())
  : new InMemoryFacetStore();

const webRoot = webRootPath();
if (Bun.env.NODE_ENV === "production") {
  requireWebRoot(webRoot);
}

const app = createFacetApp({
  store: v1Store,
  enableRequestLogging: true,
  ...(webIndexExists(webRoot) ? { webRoot } : {}),
});

const startTime = Date.now();

async function updateGauges(): Promise<void> {
  try {
    const total = await v1Store.countActiveTasks();
    tasksTotal.set(total);
    uptimeSeconds.set(Math.round((Date.now() - startTime) / 1000));
  } catch (error: unknown) {
    console.error("[metrics] failed to update gauges:", error);
  }
}

async function start(): Promise<void> {
  await updateGauges();
  setInterval(() => {
    void updateGauges();
  }, 15_000);
  console.log(
    `TaskNotes server listening on ${config.host}:${String(config.port)}`,
  );
}

void start();

export default {
  hostname: config.host,
  port: config.port,
  fetch: app.fetch,
};
