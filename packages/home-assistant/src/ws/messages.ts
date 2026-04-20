import { z } from "zod";

export const AuthRequired = z.object({
  type: z.literal("auth_required"),
  ha_version: z.string().optional(),
});

export const AuthOk = z.object({
  type: z.literal("auth_ok"),
  ha_version: z.string().optional(),
});

export const AuthInvalid = z.object({
  type: z.literal("auth_invalid"),
  message: z.string(),
});

export const AuthMessage = z.discriminatedUnion("type", [
  AuthRequired,
  AuthOk,
  AuthInvalid,
]);

export type AuthMessage = z.infer<typeof AuthMessage>;

export const ResultError = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
});

export const ResultMessage = z.object({
  id: z.number(),
  type: z.literal("result"),
  success: z.boolean(),
  result: z.unknown().optional(),
  error: ResultError.optional(),
});

export type ResultMessage = z.infer<typeof ResultMessage>;

export const EventContext = z
  .object({
    id: z.string().optional(),
    parent_id: z.string().nullable().optional(),
    user_id: z.string().nullable().optional(),
  })
  .loose();

export const EventEnvelope = z.object({
  data: z.record(z.string(), z.unknown()).optional(),
  event_type: z.string().optional(),
  time_fired: z.string().optional(),
  origin: z.string().optional(),
  context: EventContext.optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
});

export type EventEnvelope = z.infer<typeof EventEnvelope>;

export const EventMessage = z.object({
  id: z.number(),
  type: z.literal("event"),
  event: EventEnvelope,
});

export type EventMessage = z.infer<typeof EventMessage>;

export const PongMessage = z.object({
  id: z.number(),
  type: z.literal("pong"),
});

export const ServerMessage = z.discriminatedUnion("type", [
  ResultMessage,
  EventMessage,
  PongMessage,
]);

export type ServerMessage = z.infer<typeof ServerMessage>;

export type StateChangedEvent = {
  entity_id: string;
  new_state: unknown;
  old_state: unknown;
};

export const StateChangedEventData = z
  .object({
    entity_id: z.string(),
    new_state: z.unknown().optional(),
    old_state: z.unknown().optional(),
  })
  .loose();
