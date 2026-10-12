import type { Socket } from "socket.io";
import { Server } from "socket.io";
import { logger } from "#src/logger.ts";
import type http from "node:http";
import type { Duplex } from "node:stream";
import { Observable } from "rxjs";
import type { DiscordUser, Request } from "@discord-plays-mario-kart/common";
import {
  DRIVER_FEED_PATH,
  RequestSchema,
} from "@discord-plays-mario-kart/common";
import lodash from "lodash";

export type SocketChannel = {
  events: Observable<{ request: Request; socket: Socket }>;
  /** The Socket.IO server, for broadcasting responses to all clients. */
  io: Server;
  /** The Discord user signed in on a connection, if any. */
  identityOf: (socket: Socket) => DiscordUser | undefined;
};

/**
 * Resolve the signed-in user from a connection's Cookie header. The page and
 * this socket share an origin, so the browser sends the session cookie on the
 * WebSocket upgrade; a sign-in or sign-out reconnects the socket to re-read it.
 */
export type IdentifySocket = (
  cookieHeader: string | undefined,
) => Promise<DiscordUser | undefined>;

/** Socket.IO's default request path. */
const SOCKET_IO_PATH = "/socket.io/";

export function createSocket({
  server,
  isCorsEnabled,
  identify,
}: {
  server: http.Server;
  isCorsEnabled: boolean;
  identify: IdentifySocket;
}): SocketChannel {
  logger.info("starting web socket listener");

  if (isCorsEnabled) {
    logger.info("enabling cors for the web socket");
  }

  const io = new Server(server, {
    // engine.io ends every upgrade outside its own path after 1 s unless the
    // socket reports bytes written. Bun's upgraded sockets report none, so it
    // was cutting the driver feed's WebSocket every second. Upgrades are
    // policed below instead.
    destroyUpgrade: false,
    ...(isCorsEnabled
      ? {
          cors: {
            origin: "*",
            methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
            preflightContinue: false,
            optionsSuccessStatus: 204,
          },
        }
      : {}),
  });

  const identities = new WeakMap<Socket, DiscordUser>();
  const resolveIdentity = async (socket: Socket, next: () => void) => {
    try {
      const user = await identify(socket.handshake.headers.cookie);
      if (user !== undefined) identities.set(socket, user);
    } catch (error) {
      // A session-store failure must not lock spectators out of the page;
      // the connection simply plays as signed out.
      logger.error("socket identity lookup failed", error);
    }
    next();
  };
  io.use((socket, next) => {
    void resolveIdentity(socket, next);
  });

  // With engine.io's timer off, end any upgrade nobody serves at once, rather
  // than leave it open. Socket.IO owns its path; the driver feed owns its own.
  server.on("upgrade", (request: http.IncomingMessage, socket: Duplex) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === DRIVER_FEED_PATH || path.startsWith(SOCKET_IO_PATH)) return;
    socket.destroy();
  });

  const events = new Observable<{ request: Request; socket: Socket }>(
    (subscriber) => {
      io.on("connection", (socket: Socket) => {
        const identifier = lodash.uniqueId();
        logger.info("a new socket has connected", identifier);

        // The ack carries the server's wall clock so the page can estimate its
        // clock offset and correct the HUD-clock glass measurement.
        socket.on("ping", (callback: (serverNowMs: number) => void) => {
          callback(Date.now());
        });

        socket.on("disconnect", () => {
          logger.info("a socket has disconnected", identifier);
        });

        socket.on("request", (event: unknown) => {
          const result = RequestSchema.safeParse(event);
          if (result.success) {
            // Input arrives per keypress and latency reports every 2s per
            // client — logging those at info floods Loki during gameplay.
            const chatty =
              result.data.kind === "input" ||
              result.data.kind === "latency-report";
            if (chatty) {
              logger.debug("request parsed", identifier, result.data);
            } else {
              logger.info("request parsed", identifier, result.data);
            }
            subscriber.next({ request: result.data, socket });
          } else {
            logger.error("unable to parse request", identifier, event);
          }
        });
      });
    },
  );

  return {
    events,
    io,
    identityOf: (socket) => identities.get(socket),
  };
}
