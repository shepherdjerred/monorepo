export { HomeAssistantRestClient } from "./rest/client.ts";
export type { CallServiceOptions, HistoryOptions } from "./rest/client.ts";
export { HaApiError, HaAuthError, HaNotFoundError } from "./rest/errors.ts";
export type {
  EntityState,
  HaConfig,
  ServiceCallResult,
  HistoryResponse,
  FireEventResponse,
} from "./rest/schemas.ts";
export {
  EntityState as EntityStateSchema,
  HaConfig as HaConfigSchema,
  ServiceCallResult as ServiceCallResultSchema,
  HistoryResponse as HistoryResponseSchema,
  FireEventResponse as FireEventResponseSchema,
} from "./rest/schemas.ts";
export { HomeAssistantEventClient } from "./ws/client.ts";
export type {
  ConnectionStateListener,
  HomeAssistantEventClientOptions,
} from "./ws/client.ts";
export {
  HaWebSocketError,
  HaWebSocketAuthError,
  HaWebSocketClosedError,
  HaWebSocketResultError,
} from "./ws/errors.ts";
export type { EventEnvelope, EventMessage } from "./ws/messages.ts";
export { StateChangedEventData as StateChangedEventDataSchema } from "./ws/messages.ts";
export type { EventHandler, Subscription } from "./ws/subscriptions.ts";
export type { HomeAssistantConfig } from "./shared/config.ts";
