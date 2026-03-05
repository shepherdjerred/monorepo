import { Hono } from "hono";

import { config } from "./config.ts";
import { authMiddleware } from "./middleware/auth.ts";
import { corsMiddleware } from "./middleware/cors.ts";
import { loggerMiddleware } from "./middleware/logger.ts";
import { startMonitor } from "./monitor/checker.ts";
import { componentRoutes } from "./routes/components.ts";
import { healthRoutes } from "./routes/health.ts";
import { incidentRoutes } from "./routes/incidents.ts";
import { statusRoutes } from "./routes/status.ts";
import { siteRoutes } from "./routes/sites.ts";
import { uptimeRoutes } from "./routes/uptime.ts";

const app = new Hono();

app.use("*", loggerMiddleware);
app.use("*", corsMiddleware);
app.use("*", authMiddleware);

app.route("/", healthRoutes);
app.route("/", siteRoutes);
app.route("/", statusRoutes);
app.route("/", componentRoutes);
app.route("/", incidentRoutes);
app.route("/", uptimeRoutes);

startMonitor();

console.log(`status-page-api listening on port ${String(config.port)}`);

export default {
  port: config.port,
  fetch: app.fetch,
};
