/**
 * Mux TypeScript Client Library
 *
 * Provides type-safe access to the Mux HTTP API and real-time WebSocket connections.
 */

// Re-export types from shared package
export type * from "@mux/shared";

// Export main client
export { MuxClient, type MuxClientConfig } from "./MuxClient.js";

// Export WebSocket clients
export { EventsClient, type EventsClientConfig, type SessionEvent } from "./EventsClient.js";
export { ConsoleClient, type ConsoleClientConfig } from "./ConsoleClient.js";

// Export errors
export {
  MuxError,
  NetworkError,
  ApiError,
  SessionNotFoundError,
  WebSocketError,
} from "./errors.js";
