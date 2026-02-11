import { createServer } from "http";
import { logger } from "../logger.js";
import { createExpressApp } from "./express.js";
import { createSocket } from "./socket.js";

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

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const app = createExpressApp({ isCorsEnabled, webAssetsPath });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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

  /* eslint-disable @typescript-eslint/no-unsafe-assignment */
  return {
    server,
    socket,
    app,
  };
  /* eslint-enable @typescript-eslint/no-unsafe-assignment */
}
