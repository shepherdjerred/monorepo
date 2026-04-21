import { proxyActivities, sleep } from "@temporalio/workflow";
import type {
  Domain,
  EntityId,
  EntityIdByDomain,
  EntityState,
  Service,
  ServiceDataFor,
} from "@shepherdjerred/home-assistant";
import type { HaActivities } from "#activities/ha.ts";
import type { HaSchema } from "#generated/ha-schema.ts";

const activities = proxyActivities<HaActivities>({
  startToCloseTimeout: "30 seconds",
});

// Activity-facing API is stringly-typed (Temporal can't proxy generics). The
// wrappers below narrow each call against the generated HaSchema so workflows
// get compile-time rejection of unknown entities, domains, services, and
// bad service data. At runtime the args pass through as plain strings/objects.

export async function getEntityState<E extends EntityId<HaSchema>>(
  entityId: E,
): Promise<EntityState & { entity_id: E }> {
  const state = await activities.getEntityState(entityId);
  // HA returns the entity we asked for by ID, so entity_id on the response is
  // guaranteed to equal the input. Re-stamping it here narrows the type to
  // the literal without a cast.
  return { ...state, entity_id: entityId };
}

export async function getStates(): Promise<EntityState[]> {
  return activities.getStates();
}

export async function callService<
  D extends Domain<HaSchema>,
  V extends Service<HaSchema, D>,
>(domain: D, service: V, data: ServiceDataFor<HaSchema, D, V>): Promise<void> {
  return activities.callService(domain, service, data);
}

/**
 * Untyped escape hatch for call sites that iterate over entity IDs pulled
 * from {@link getEntitiesInDomain} or similar runtime sources — the entity_id
 * is known-safe (domain-filtered at runtime) but TS can't prove the literal.
 * Prefer {@link callService} when the entity_id is a compile-time literal.
 */
export async function callServiceUnchecked(
  domain: string,
  service: string,
  data: Record<string, unknown>,
): Promise<void> {
  return activities.callService(domain, service, data);
}

export async function sendNotification(
  title: string,
  message: string,
): Promise<void> {
  return activities.sendNotification(title, message);
}

export async function getEntitiesInDomain(
  domain: Domain<HaSchema>,
): Promise<EntityState[]> {
  return activities.getEntitiesInDomain(domain);
}

export const VACUUM_START_STATES = new Set([
  "idle",
  "docked",
  "charging",
  "paused",
]);

export const VACUUM_STOP_STATES = new Set(["cleaning", "paused", "idle"]);

export function shouldStartVacuum(state: string): boolean {
  return VACUUM_START_STATES.has(state);
}

export function shouldStopVacuum(state: string): boolean {
  return VACUUM_STOP_STATES.has(state);
}

/**
 * Verifies an entity reaches a matching state. Accepts plain `string` so
 * iterated entity IDs from {@link getEntitiesInDomain} work; callers with
 * compile-time literals get typo protection at the source declaration.
 */
export async function verifyState(
  entityId: string,
  matches: (state: string) => boolean,
  options: { delaySeconds: number; retries: number; retryDelaySeconds: number },
): Promise<boolean> {
  await sleep(options.delaySeconds * 1000);
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const state = await activities.getEntityState(entityId);
    if (matches(state.state)) {
      return true;
    }
    if (attempt === options.retries) {
      break;
    }
    await sleep(options.retryDelaySeconds * 1000);
  }
  console.warn(`Verify failed: ${entityId} did not reach expected state`);
  return false;
}

export function matchExact(expected: string): (state: string) => boolean {
  return (state) => state === expected;
}

export async function everyoneAway(): Promise<boolean> {
  const [jerred, shuxin] = await Promise.all([
    getEntityState("person.jerred"),
    getEntityState("person.shuxin"),
  ]);
  return jerred.state === "not_home" && shuxin.state === "not_home";
}

export async function anyoneHome(): Promise<boolean> {
  const [jerred, shuxin] = await Promise.all([
    getEntityState("person.jerred"),
    getEntityState("person.shuxin"),
  ]);
  return jerred.state === "home" || shuxin.state === "home";
}

export async function volumeUpBy(
  entityId: EntityIdByDomain<HaSchema, "media_player">,
  steps: number,
  delayBetweenSeconds: number,
): Promise<void> {
  for (let i = 0; i < steps; i += 1) {
    await callService("media_player", "volume_up", { entity_id: entityId });
    if (i < steps - 1) {
      await sleep(delayBetweenSeconds * 1000);
    }
  }
}
