/**
 * Hand-curated event data shapes for well-known Home Assistant event types.
 * These are layered under the generated event list so consumers get narrowed
 * `event.data` payloads on common subscriptions without having to declare
 * them themselves. Unknown events default to `Record<string, unknown>`.
 *
 * Source: Home Assistant core event definitions.
 */
export const KNOWN_EVENT_DATA: Readonly<Record<string, string>> = {
  state_changed: `{ entity_id: string; old_state: unknown; new_state: unknown }`,
  call_service: `{ domain: string; service: string; service_data?: Record<string, unknown>; service_call_id?: string }`,
  service_registered: `{ domain: string; service: string }`,
  service_removed: `{ domain: string; service: string }`,
  component_loaded: `{ component: string }`,
  automation_triggered: `{ name: string; entity_id: string; source?: string }`,
  script_started: `{ name: string; entity_id: string }`,
  homeassistant_start: `Record<string, never>`,
  homeassistant_started: `Record<string, never>`,
  homeassistant_stop: `Record<string, never>`,
  homeassistant_final_write: `Record<string, never>`,
  user_added: `{ user_id: string }`,
  user_removed: `{ user_id: string }`,
  logbook_entry: `{ name?: string; message?: string; entity_id?: string; domain?: string }`,
} as const;
