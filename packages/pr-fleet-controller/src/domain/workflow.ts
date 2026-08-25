import {
  FleetTickReportSchema,
  TickTriggerSchema,
  type FleetTickReport,
  type TickTrigger,
} from "./schemas.ts";

export function createFleetTickWorkflow(
  executeTick: (trigger: TickTrigger) => Promise<FleetTickReport>,
): (trigger: TickTrigger) => Promise<FleetTickReport> {
  return async (trigger) => {
    const validatedTrigger = TickTriggerSchema.parse(trigger);
    return FleetTickReportSchema.parse(await executeTick(validatedTrigger));
  };
}
