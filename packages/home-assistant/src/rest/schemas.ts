import { z } from "zod";

export const EntityState = z.object({
  entity_id: z.string(),
  state: z.string(),
  attributes: z.record(z.string(), z.unknown()),
  last_changed: z.string().optional(),
  last_updated: z.string().optional(),
  last_reported: z.string().optional(),
  context: z
    .object({
      id: z.string(),
      parent_id: z.string().nullable().optional(),
      user_id: z.string().nullable().optional(),
    })
    .optional(),
});

export type EntityState = z.infer<typeof EntityState>;

export const HaConfig = z
  .object({
    location_name: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    elevation: z.number(),
    time_zone: z.string(),
    version: z.string(),
    components: z.array(z.string()),
    unit_system: z.record(z.string(), z.string()),
  })
  .loose();

export type HaConfig = z.infer<typeof HaConfig>;

export const ServiceCallResult = z.array(EntityState);

export type ServiceCallResult = z.infer<typeof ServiceCallResult>;

export const FireEventResponse = z.object({
  message: z.string(),
});

export type FireEventResponse = z.infer<typeof FireEventResponse>;

export const HistoryResponse = z.array(z.array(EntityState));

export type HistoryResponse = z.infer<typeof HistoryResponse>;
