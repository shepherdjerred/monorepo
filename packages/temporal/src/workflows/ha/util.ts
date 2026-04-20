import { proxyActivities, sleep } from "@temporalio/workflow";
import type { HaActivities } from "#activities/ha.ts";

const activities = proxyActivities<HaActivities>({
  startToCloseTimeout: "30 seconds",
});

export const {
  getEntityState,
  getStates,
  callService,
  sendNotification,
  getEntitiesInDomain,
} = activities;

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

export async function verifyState(
  entityId: string,
  matches: (state: string) => boolean,
  options: { delaySeconds: number; retries: number; retryDelaySeconds: number },
): Promise<boolean> {
  await sleep(`${String(options.delaySeconds)} seconds`);
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const state = await getEntityState(entityId);
    if (matches(state.state)) {
      return true;
    }
    if (attempt === options.retries) {
      break;
    }
    await sleep(`${String(options.retryDelaySeconds)} seconds`);
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
  entityId: string,
  steps: number,
  delayBetweenSeconds: number,
): Promise<void> {
  for (let i = 0; i < steps; i += 1) {
    await callService("media_player", "volume_up", { entity_id: entityId });
    if (i < steps - 1) {
      await sleep(`${String(delayBetweenSeconds)} seconds`);
    }
  }
}

export async function openCoversSequentially(
  coverIds: readonly string[],
): Promise<void> {
  for (const id of coverIds) {
    await callService("cover", "open_cover", { entity_id: id });
    await sleep("1 second");
  }
}

export async function closeCoversSequentially(
  coverIds: readonly string[],
): Promise<void> {
  for (const id of coverIds) {
    await callService("cover", "close_cover", { entity_id: id });
    await sleep("1 second");
  }
}
