import type { Client } from "@temporalio/client";
import { z } from "zod";

const ScheduleReconciliationModeSchema = z.enum([
  "enabled",
  "disabled",
  "auto",
]);

export type ScheduleReconciliationMode = z.infer<
  typeof ScheduleReconciliationModeSchema
>;

export function parseScheduleReconciliationMode(
  value: string | undefined,
): ScheduleReconciliationMode {
  return ScheduleReconciliationModeSchema.parse(value ?? "enabled");
}

/**
 * The migration-safe gateway mode may inspect the legacy namespace, but it
 * must not write there. Once every source schedule is paused, target
 * reconciliation is safe to enable on the next gateway restart.
 */
export async function isScheduleNamespaceDrained(
  client: Client,
): Promise<boolean> {
  for await (const schedule of client.schedule.list()) {
    const description = await client.schedule
      .getHandle(schedule.scheduleId)
      .describe();
    if (!description.state.paused) return false;
  }
  return true;
}
