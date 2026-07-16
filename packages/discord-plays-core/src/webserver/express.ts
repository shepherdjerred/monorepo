import express, { type Express } from "express";
import cors from "cors";
import type { Registry } from "prom-client";
import type { Logger } from "#src/logger.ts";

export type CreateExpressAppOptions = {
  isCorsEnabled: boolean;
  webAssetsPath: string;
  /** Prometheus registry scraped at GET /metrics (each game passes its own registry). */
  registry: Registry;
  logger: Logger;
  /** Throw if the web assets directory is missing (each game injects its own game-branded assertion). */
  assertPathExists: (path: string, pathName: string) => void;
};

export function createExpressApp({
  isCorsEnabled,
  webAssetsPath,
  registry,
  logger,
  assertPathExists,
}: CreateExpressAppOptions): Express {
  logger.info("creating express app");

  const app = express();

  if (isCorsEnabled) {
    logger.info("enabling cors for the express app");

    app.use(cors());
  } else {
    logger.info("not enabling cors for the express app");
  }

  // Prometheus scrape endpoint (registered before the static handler so it isn't
  // shadowed). Frame-loop + default process metrics; see observability/metrics.ts.
  app.get("/metrics", async (_req, res) => {
    try {
      const body = await registry.metrics();
      res.set("Content-Type", registry.contentType).send(body);
    } catch (error) {
      logger.error("failed to collect metrics", { error });
      res.status(500).end();
    }
  });

  assertPathExists(webAssetsPath, "web assets");

  logger.info(`serving static web assets from ${webAssetsPath}`);

  app.use(express.static(webAssetsPath));

  return app;
}
