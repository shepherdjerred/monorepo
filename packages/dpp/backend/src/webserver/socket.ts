import { Server, Socket } from "socket.io";
import { logger } from "../logger.js";
import http from "http";
import { Observable, fromEvent } from "rxjs";
import { Request, RequestSchema } from "@shepherdjerred/dpp-common";
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

  const connection = fromEvent(io, "connection");

  return new Observable((subscriber) => {
    connection.subscribe((socket) => {
      const identifier = lodash.uniqueId();
      logger.info("a new socket has connected", identifier);

      (socket as Socket).on("ping", (callback: () => void) => {
        callback();
      });

      fromEvent(socket as Socket, "disconnect").subscribe((_event) => {
        logger.info("a socket has disconnected", identifier);
      });

      fromEvent(socket as Socket, "request").subscribe((event) => {
        logger.info("request received", identifier);
        const result = RequestSchema.safeParse(event);
        if (result.success) {
          logger.info("request parsed", identifier, result.data);
          subscriber.next({ request: result.data, socket: socket as Socket });
        } else {
          logger.error("unable to parse request", identifier, event);
        }
      });
    });
  });
}
