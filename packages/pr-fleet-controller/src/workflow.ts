import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  FleetTickReportSchema,
  TickTriggerSchema,
  type FleetTickReport,
  type TickTrigger,
} from "./schemas.ts";

export function createFleetTickWorkflow(
  executeTick: (trigger: TickTrigger) => Promise<FleetTickReport>,
) {
  const reconcile = createStep({
    id: "reconcile-complete-fleet",
    description:
      "Refresh, classify, dispatch, audit, and report the complete PR fleet.",
    inputSchema: z.object({ trigger: TickTriggerSchema }),
    outputSchema: FleetTickReportSchema,
    execute: async ({ inputData }) => executeTick(inputData.trigger),
  });

  const workflow = createWorkflow({
    id: "pr-fleet-tick",
    inputSchema: z.object({ trigger: TickTriggerSchema }),
    outputSchema: FleetTickReportSchema,
  });
  const appendStep = workflow.then.bind(workflow);
  return appendStep(reconcile).commit();
}
