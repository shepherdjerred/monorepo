export { HomeAssistantRestClient } from "./rest/client.js";
export type { CallServiceOptions, HistoryOptions } from "./rest/client.js";
export { HaApiError, HaAuthError, HaNotFoundError } from "./rest/errors.js";
export type {
  EntityState,
  HaConfig,
  ServiceCallResult,
  ServiceCallChangedStates,
  ServiceCallWithResponse,
  HistoryResponse,
  FireEventResponse,
  ConfigEntryDiagnostics,
} from "./rest/schemas.js";
export {
  EntityState as EntityStateSchema,
  HaConfig as HaConfigSchema,
  ServiceCallResult as ServiceCallResultSchema,
  ServiceCallChangedStates as ServiceCallChangedStatesSchema,
  ServiceCallWithResponse as ServiceCallWithResponseSchema,
  HistoryResponse as HistoryResponseSchema,
  FireEventResponse as FireEventResponseSchema,
  ConfigEntryDiagnostics as ConfigEntryDiagnosticsSchema,
} from "./rest/schemas.js";
export { HomeAssistantEventClient } from "./ws/client.js";
export type {
  ConnectionStateListener,
  HomeAssistantEventClientOptions,
} from "./ws/client.js";
export {
  HaWebSocketError,
  HaWebSocketAuthError,
  HaWebSocketClosedError,
  HaWebSocketResultError,
} from "./ws/errors.js";
export type {
  EntityRegistryEntry,
  EventEnvelope,
  EventMessage,
} from "./ws/messages.js";
export {
  EntityRegistryEntry as EntityRegistryEntrySchema,
  StateChangedEventData as StateChangedEventDataSchema,
} from "./ws/messages.js";
export type { EventHandler, Subscription } from "./ws/subscriptions.js";
export type { HomeAssistantConfig } from "./shared/config.js";
export type {
  Domain,
  EntityAttributesFor,
  EntityId,
  EntityIdByDomain,
  EntityStateFor,
  EventDataFor,
  EventEnvelopeFor,
  EventType,
  HaEntityMeta,
  HaFieldType,
  HaSchema,
  HaServiceFieldMeta,
  HaServiceMeta,
  DefaultHaSchema,
  Service,
  ServiceDataFor,
} from "./schema/types.js";
