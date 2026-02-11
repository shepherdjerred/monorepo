import express from "express";
import cors from "cors";
import { assertPathExists } from "../util.js";
import { logger } from "../logger.js";

export function createExpressApp({ isCorsEnabled, webAssetsPath }: { isCorsEnabled: boolean; webAssetsPath: string }) {
  logger.info("creating express app");

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const app = express();

  if (isCorsEnabled) {
    logger.info("enabling cors for the express app");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    app.use(cors());
  } else {
    logger.info("not enabling cors for the express app");
  }

  assertPathExists(webAssetsPath, "web assets");

  logger.info(`serving static web assets from ${webAssetsPath}`);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  app.use(express.static(webAssetsPath));

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return app;
}
