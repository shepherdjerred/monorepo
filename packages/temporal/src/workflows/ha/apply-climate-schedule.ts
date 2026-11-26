import { applyHomeClimate } from "./climate-apply.ts";

/**
 * Clock fire for the occupied climate policy: midnight setback, 08:00 day
 * start, and 09:00 re-assert. Presence edges use reconcileClimate. This
 * run covers the house when nobody crosses a geofence.
 */
export async function applyClimateSchedule(): Promise<void> {
  await applyHomeClimate();
}
