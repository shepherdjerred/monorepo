import express from "express";
import cors from "cors";
import { assertPathExists } from "#src/util.ts";
import { logger } from "#src/logger.ts";
import { registry } from "#src/observability/metrics.ts";

export function createExpressApp({
  isCorsEnabled,
  webAssetsPath,
}: {
  isCorsEnabled: boolean;
  webAssetsPath: string;
}) {
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
