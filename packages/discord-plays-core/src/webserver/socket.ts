// The Socket.IO channel both games' web UIs talk to. Core owns how the server is
// stood up — CORS, upgrade policing, the ping ack, request parsing — and hands
// each parsed request to the game, which owns dispatch.
import type http from "node:http";
import type { Duplex } from "node:stream";
import { Observable } from "rxjs";
import { Server, type Socket } from "socket.io";
import type { z } from "zod";
import type { Logger } from "#src/logger.ts";

/** Socket.IO's default request path. */
export const SOCKET_IO_PATH = "/socket.io/";

export type GameSocketEvent<TRequest> = {
  readonly request: TRequest;
  readonly socket: Socket;
};

export type GameSocketChannel<TRequest, TIdentity = never> = {
  readonly events: Observable<GameSocketEvent<TRequest>>;
  /** The Socket.IO server, for broadcasting responses to all clients. */
  readonly io: Server;
  /** Who is signed in on a connection, as `identify` resolved it. */
  readonly identityOf: (socket: Socket) => TIdentity | undefined;
};

/**
 * Resolve the signed-in user from a connection's Cookie header. The page and
 * the socket share an origin, so the browser sends the session cookie on the
 * WebSocket upgrade; a sign-in or sign-out reconnects the socket to re-read it.
 */
export type IdentifySocket<TIdentity> = (
  cookieHeader: string | undefined,
) => Promise<TIdentity | undefined>;

export type CreateGameSocketOptions<
  TRequest extends { kind: string },
  TIdentity = never,
> = {
  readonly server: http.Server;
  readonly isCorsEnabled: boolean;
  /** Every request a client sends must parse against this schema. */
  readonly requestSchema: z.ZodType<TRequest>;
  /**
   * Upgrade paths other handlers on this server serve, such as the driver
   * feed. Any other non-Socket.IO upgrade is ended immediately.
   */
  readonly ownedUpgradePaths: readonly string[];
  /**
   * Request kinds sent per keypress or on a timer. Logged at debug so gameplay
   * does not flood Loki.
   */
  readonly quietKinds?: readonly TRequest["kind"][];
  /** Resolve each connection's signed-in user; omit for anonymous pages. */
  readonly identify?: IdentifySocket<TIdentity>;
  /** When supplied, admit browser handshakes only from this deployment origin. */
  readonly allowedOrigin?: string;
  readonly logger: Logger;
};

export function createGameSocket<
  TRequest extends { kind: string },
  TIdentity = never,
>({
  server,
  isCorsEnabled,
  requestSchema,
  ownedUpgradePaths,
  quietKinds = [],
  identify,
  allowedOrigin,
  logger,
}: CreateGameSocketOptions<TRequest, TIdentity>): GameSocketChannel<
  TRequest,
  TIdentity
> {
  logger.info("starting web socket listener");

  if (isCorsEnabled) {
    logger.info("enabling cors for the web socket");
  }

  const io = new Server(server, {
    ...(allowedOrigin === undefined
      ? {}
      : {
          allowRequest: (
            request: http.IncomingMessage,
            done: (error: string | null, success: boolean) => void,
          ) => {
            done(null, request.headers.origin === allowedOrigin);
          },
        }),
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

  const identities = new WeakMap<Socket, TIdentity>();
  if (identify !== undefined) {
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
  }

  // With engine.io's timer off, end any upgrade nobody serves at once, rather
  // than leave it open. Socket.IO owns its path; other handlers own theirs.
  server.on("upgrade", (request: http.IncomingMessage, socket: Duplex) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (ownedUpgradePaths.includes(path) || path.startsWith(SOCKET_IO_PATH)) {
      return;
    }
    socket.destroy();
  });

  let nextIdentifier = 0;
  const events = new Observable<GameSocketEvent<TRequest>>((subscriber) => {
    io.on("connection", (socket: Socket) => {
      nextIdentifier += 1;
      const identifier = String(nextIdentifier);
      logger.info("a new socket has connected", identifier);

      // The ack carries the server's wall clock so a page can estimate its
      // clock offset against the server.
      socket.on("ping", (callback: (serverNowMs: number) => void) => {
        callback(Date.now());
      });

      socket.on("disconnect", () => {
        logger.info("a socket has disconnected", identifier);
      });

      socket.on("request", (event: unknown) => {
        const result = requestSchema.safeParse(event);
        if (!result.success) {
          logger.error("unable to parse request", identifier, event);
          return;
        }
        if (quietKinds.includes(result.data.kind)) {
          logger.debug("request parsed", identifier, result.data);
        } else {
          logger.info("request parsed", identifier, result.data);
        }
        subscriber.next({ request: result.data, socket });
      });
    });
  });

  return {
    events,
    io,
    identityOf: (socket) => identities.get(socket),
  };
}
