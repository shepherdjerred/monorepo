import { Hono } from "hono";
import { createAuthMiddleware } from "./middleware/auth.ts";
import { loggerMiddleware } from "./middleware/logger.ts";
import { metricsMiddleware } from "./middleware/metrics.ts";
import { createHealthRoutes } from "./routes/health.ts";
import { requireAdminPrincipal } from "./v1/request-context.ts";
import { v1Routes } from "./v1/routes.ts";
import type { FacetStore } from "./v1/types.ts";

export type CreateFacetAppOptions = {
  store: FacetStore;
  getAuthToken?: (() => string) | undefined;
  enableRequestLogging?: boolean | undefined;
};

export function createFacetApp(options: CreateFacetAppOptions): Hono {
  const app = new Hono();

  if (options.enableRequestLogging === true) {
    app.use("*", loggerMiddleware);
  }
  app.use("*", metricsMiddleware);
  app.use(
    "*",
    createAuthMiddleware({
      store: options.store,
      getAuthToken: options.getAuthToken,
    }),
  );

  app.route(
    "/",
    createHealthRoutes({
      store: options.store,
      getAuthToken: options.getAuthToken,
    }),
  );
  app.route("/", v1Routes({ store: options.store }));

  app.get("/api/engine-status", async (c) => {
    const adminDenied = requireAdminPrincipal(c);
    if (adminDenied !== null) {
      return adminDenied;
    }
    const tasks = await options.store.countActiveTasks();
    return c.json({
      status: "ok",
      storage: "postgres",
      configSource: "postgres",
      tasks,
      skippedFiles: [],
    });
  });

  return app;
}
