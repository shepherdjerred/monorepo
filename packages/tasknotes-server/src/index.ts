import "./bugsink.ts";
import { Hono } from "hono";

import { config } from "./config.ts";
import { getDatabase } from "./infrastructure/database.ts";
import { tasksTotal, uptimeSeconds } from "./metrics.ts";
import { authMiddleware } from "./middleware/auth.ts";
import { loggerMiddleware } from "./middleware/logger.ts";
import { metricsMiddleware } from "./middleware/metrics.ts";
import { healthRoutes } from "./routes/health.ts";
import { InMemoryFacetStore } from "./v1/in-memory-store.ts";
import { PrismaFacetStore } from "./v1/prisma-store.ts";
import { v1Routes } from "./v1/routes.ts";

const app = new Hono();

app.use("*", loggerMiddleware);
app.use("*", metricsMiddleware);
app.use("*", authMiddleware);

app.route("/", healthRoutes);

const hasDatabaseUrl =
  Bun.env["DATABASE_URL"] !== undefined && Bun.env["DATABASE_URL"] !== "";
const v1Store = hasDatabaseUrl
  ? new PrismaFacetStore(getDatabase())
  : new InMemoryFacetStore();

app.route("/", v1Routes({ store: v1Store }));

app.get("/api/engine-status", async (c) => {
  const tasks = await v1Store.countActiveTasks();
  return c.json({
    status: "ok",
    storage: "postgres",
    configSource: "postgres",
    tasks,
    skippedFiles: [],
  });
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
