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
