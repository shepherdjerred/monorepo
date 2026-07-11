import { createServer, type Server } from "node:http";
import type { Express } from "express";
import type { Registry } from "prom-client";
import type { Logger } from "#src/logger.ts";
import { createExpressApp } from "#src/webserver/express.ts";

export type WebServerHandles<TSocket> = {
  server: Server;
  socket: TSocket | undefined;
  app: Express;
};

export type CreateWebServerOptions<TSocket> = {
  port: number;
  isCorsEnabled: boolean;
  isApiEnabled: boolean;
  webAssetsPath: string;
  registry: Registry;
  logger: Logger;
  assertPathExists: (path: string, pathName: string) => void;
  /**
   * Stand up the game's socket channel on the HTTP server. Only called when
   * `isApiEnabled`. The return type is game-specific (pokemon returns a bare
   * Observable, mario-kart returns `{ events, io }`), so callers get it back
   * verbatim in `socket`.
   */
  createSocket: (args: { server: Server; isCorsEnabled: boolean }) => TSocket;
};

export function createWebServer<TSocket>({
  port,
  isCorsEnabled,
  isApiEnabled,
  webAssetsPath,
  registry,
  logger,
  assertPathExists,
  createSocket,
}: CreateWebServerOptions<TSocket>): WebServerHandles<TSocket> {
  logger.info("creating web server");

  const app = createExpressApp({
    isCorsEnabled,
    webAssetsPath,
    registry,
    logger,
    assertPathExists,
  });

  const server = createServer(app);

  let socket: TSocket | undefined;
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
