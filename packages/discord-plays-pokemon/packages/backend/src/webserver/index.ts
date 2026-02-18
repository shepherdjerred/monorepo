import { createServer } from "node:http";
import { logger } from "@shepherdjerred/discord-plays-pokemon/packages/backend/src/logger.js";
import { createExpressApp } from "./express.ts";
import { createSocket } from "./socket.ts";

export function createWebServer({
  port,
  isCorsEnabled,
  isApiEnabled,
  webAssetsPath,
}: {
  port: number;
  isCorsEnabled: boolean;
  isApiEnabled: boolean;
  webAssetsPath: string;
}) {
  logger.info("creating web server");

  const app = createExpressApp({ isCorsEnabled, webAssetsPath });

  const server = createServer(app);

  let socket;
  if (isApiEnabled) {
    socket = createSocket({ isCorsEnabled, server });
  }

  server.listen(port, () => {
    const address = server.address();
    if (typeof address === "string") {
      logger.info(`web server is listening on port ${address}`);
    }
  });

  return {
    server,
    socket,
    app,
  };
}
