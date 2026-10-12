import { io } from "socket.io-client";

// WebSocket from the first packet. The default starts on HTTP long-polling and
// upgrades later, so a driver's first inputs would ride HTTP POSTs through the
// tunnel, and a failed upgrade would leave them there for the whole session.
export const socket = io({ transports: ["websocket"] });
