import { io, type Socket } from "socket.io-client";

/**
 * The page's Socket.IO connection to its game backend, same origin.
 *
 * WebSocket from the first packet. The default starts on HTTP long-polling and
 * upgrades later, so a player's first inputs would ride HTTP POSTs through the
 * tunnel, and a failed upgrade would leave them there for the whole session.
 */
export function createGameSocketClient(): Socket {
  return io({ transports: ["websocket"] });
}
