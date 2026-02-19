import type { Socket } from "socket.io";
import { Server } from "socket.io";
import { logger } from "#src/logger.ts";
import type http from "node:http";
import { Observable } from "rxjs";
import type { Request } from "@discord-plays-pokemon/common";
import { RequestSchema } from "@discord-plays-pokemon/common";
import lodash from "lodash";

export function createSocket({
  server,
  isCorsEnabled,
}: {
  server: http.Server;
  isCorsEnabled: boolean;
}): Observable<{ request: Request; socket: Socket }> {
  logger.info("starting web socket listener");

  let cors;

  if (isCorsEnabled) {
    logger.info("enabling cors for the web socket");
    cors = {
      origin: "*",
      methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
      preflightContinue: false,
      optionsSuccessStatus: 204,
    };
  }

  const io = new Server(server, {
    cors,
  });

  return new Observable((subscriber) => {
    io.on("connection", (socket: Socket) => {
      const identifier = lodash.uniqueId();
      logger.info("a new socket has connected", identifier);

      socket.on("ping", (callback: () => void) => {
        callback();
      });

      socket.on("disconnect", () => {
        logger.info("a socket has disconnected", identifier);
      });

      socket.on("request", (event: unknown) => {
        logger.info("request received", identifier);
        const result = RequestSchema.safeParse(event);
        if (result.success) {
          logger.info("request parsed", identifier, result.data);
          subscriber.next({ request: result.data, socket });
        } else {
          logger.error("unable to parse request", identifier, event);
        }
      });
    });
  });
}
