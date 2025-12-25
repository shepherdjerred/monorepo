/**
 * Messages sent from client to server
 */
export type ClientMessage =
  | { type: "prompt"; content: string }
  | { type: "interrupt" }
  | { type: "ping" };

/**
 * Messages sent from server to client
 * These mirror the Agent SDK message types
 */
export type ServerMessage =
  | { type: "ready"; sessionId: string }
  | { type: "system"; data: unknown }
  | { type: "assistant"; content: unknown[] }
  | { type: "result"; subtype: "success" | "error"; result?: string; error?: string }
  | { type: "interrupted" }
  | { type: "error"; message: string }
  | { type: "pong" };

/**
 * Connection state
 */
export interface WebSocketConnection {
  ws: WebSocket;
  sessionId: string;
  userId: string;
  containerId: string;
  createdAt: Date;
}
