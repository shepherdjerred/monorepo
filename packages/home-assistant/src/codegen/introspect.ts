import { z } from "zod";

/**
 * REST-level introspection of a live Home Assistant instance. Hits the four
 * endpoints we need — /api/states, /api/services, /api/events, /api/config —
 * and returns validated payloads. Fails fast on any HTTP error.
 */

export const EntityStateSnapshot = z
  .object({
    entity_id: z.string(),
    state: z.string(),
    attributes: z.record(z.string(), z.unknown()),
  })
  .loose();
export type EntityStateSnapshot = z.infer<typeof EntityStateSnapshot>;

export const ServiceFieldSelectorEntity = z
  .object({
    entity: z
      .union([
        z
          .object({
            domain: z.union([z.string(), z.array(z.string())]).optional(),
          })
          .loose(),
        z.array(
          z
            .object({
              domain: z.union([z.string(), z.array(z.string())]).optional(),
            })
            .loose(),
        ),
      ])
      .optional(),
  })
  .loose();

export const ServiceFieldSelector = z
  .object({
    number: z.unknown().optional(),
    text: z.unknown().optional(),
    boolean: z.unknown().optional(),
    entity: z.unknown().optional(),
    object: z.unknown().optional(),
    template: z.unknown().optional(),
    select: z
      .object({
        options: z
          .array(z.union([z.string(), z.object({ value: z.string() }).loose()]))
          .optional(),
      })
      .loose()
      .optional(),
  })
  .loose();
export type ServiceFieldSelector = z.infer<typeof ServiceFieldSelector>;

export const ServiceFieldSpec = z
  .object({
    required: z.boolean().optional(),
    description: z.string().optional(),
    example: z.unknown().optional(),
    default: z.unknown().optional(),
    selector: ServiceFieldSelector.optional(),
  })
  .loose();
export type ServiceFieldSpec = z.infer<typeof ServiceFieldSpec>;

export const ServiceTargetSpec = z
  .object({
    entity: z
      .union([
        z
          .object({
            domain: z.union([z.string(), z.array(z.string())]).optional(),
          })
          .loose(),
        z.array(
          z
            .object({
              domain: z.union([z.string(), z.array(z.string())]).optional(),
            })
            .loose(),
        ),
      ])
      .optional(),
  })
  .loose();
export type ServiceTargetSpec = z.infer<typeof ServiceTargetSpec>;

export const ServiceSpec = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    fields: z.record(z.string(), ServiceFieldSpec).optional(),
    target: ServiceTargetSpec.optional(),
    response: z
      .union([
        z.boolean(),
        z.object({ optional: z.boolean().optional() }).loose(),
      ])
      .optional(),
  })
  .loose();
export type ServiceSpec = z.infer<typeof ServiceSpec>;

export const DomainServicesEntry = z.object({
  domain: z.string(),
  services: z.record(z.string(), ServiceSpec),
});
export type DomainServicesEntry = z.infer<typeof DomainServicesEntry>;

export const ServicesResponse = z.array(DomainServicesEntry);
export type ServicesResponse = z.infer<typeof ServicesResponse>;

export const EventListEntry = z
  .object({
    event: z.string(),
    listener_count: z.number().optional(),
  })
  .loose();
export type EventListEntry = z.infer<typeof EventListEntry>;

export const EventsResponse = z.array(EventListEntry);
export type EventsResponse = z.infer<typeof EventsResponse>;

export const ConfigResponse = z
  .object({
    version: z.string().optional(),
    components: z.array(z.string()).optional(),
    time_zone: z.string().optional(),
  })
  .loose();
export type ConfigResponse = z.infer<typeof ConfigResponse>;

export type HaIntrospection = {
  states: EntityStateSnapshot[];
  services: ServicesResponse;
  events: EventsResponse;
  config: ConfigResponse;
};

export async function introspect(
  baseUrl: string,
  token: string,
): Promise<HaIntrospection> {
  const normalized = baseUrl.replace(/\/+$/u, "");
  const [states, services, events, config] = await Promise.all([
    fetchJson(normalized, token, "/api/states", z.array(EntityStateSnapshot)),
    fetchJson(normalized, token, "/api/services", ServicesResponse),
    fetchJson(normalized, token, "/api/events", EventsResponse),
    fetchJson(normalized, token, "/api/config", ConfigResponse),
  ]);
  return { states, services, events, config };
}

async function fetchJson<T>(
  baseUrl: string,
  token: string,
  path: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `ha-codegen: GET ${path} failed: ${String(response.status)} ${response.statusText}${text === "" ? "" : ` — ${text}`}`,
    );
  }
  const body = (await response.json()) as unknown;
  return schema.parse(body);
}
