/**
 * Clauderon TypeScript Client Library
 *
 * Provides type-safe access to the Clauderon HTTP API and real-time WebSocket connections.
 */

// Re-export types from shared package
export type * from "@clauderon/shared";

// Export main client
export { ClauderonClient } from "./clauderon-client.ts";
export type { ClauderonClientConfig, StorageClassInfo } from "./client-types.ts";

// Export WebSocket clients
export {
  EventsClient,
  type EventsClientConfig,
  type SessionEvent,
} from "./events-client.ts";
export { ConsoleClient, type ConsoleClientConfig } from "./console-client.ts";

// Export errors
export {
  ClauderonError,
  NetworkError,
  ApiError,
  SessionNotFoundError,
  WebSocketError,
  DecodeError,
} from "./errors.ts";
