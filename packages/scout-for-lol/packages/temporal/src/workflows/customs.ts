import { proxyActivities } from "@temporalio/workflow";
import { ApplicationFailure } from "@temporalio/common";
import { scoutTaskQueues } from "#src/identifiers.ts";
import {
  ScoutCustomOperationInputSchema,
  ScoutCustomPublicationInputSchema,
  ScoutCustomOperationResultSchema,
  type ScoutCustomActivities,
  type ScoutCustomOperationInput,
  type ScoutCustomPublicationInput,
} from "#src/customs-contracts.ts";

export async function scoutCustomOperationWorkflow(
  rawInput: ScoutCustomOperationInput,
): Promise<void> {
  const input = ScoutCustomOperationInputSchema.parse(rawInput);
  const gateway = proxyActivities<
    Pick<ScoutCustomActivities, "executeCustomOperation">
  >({
    taskQueue: scoutTaskQueues(input.stage).gateway,
    startToCloseTimeout: "5 minutes",
    scheduleToCloseTimeout: "30 minutes",
    heartbeatTimeout: "20 seconds",
    retry: {
      initialInterval: "2 seconds",
      maximumInterval: "30 seconds",
      maximumAttempts: 20,
    },
  });
  const result = ScoutCustomOperationResultSchema.parse(
    await gateway.executeCustomOperation(input),
  );
  if (result.state === "held")
    throw ApplicationFailure.nonRetryable(
      "Customs operation requires operator resolution",
      "CustomOperationHeld",
    );
  // Publication is recoverable from the PG revision watermark independently
  // of this Workflow. A gateway never publishes its process-local socket map.
}

export async function scoutCustomPublicationWorkflow(
  rawInput: ScoutCustomPublicationInput,
): Promise<void> {
  const input = ScoutCustomPublicationInputSchema.parse(rawInput);
  const application = proxyActivities<
    Pick<ScoutCustomActivities, "publishCustomNight">
  >({
    taskQueue: scoutTaskQueues(input.stage).interactive,
    startToCloseTimeout: "2 minutes",
    scheduleToCloseTimeout: "10 minutes",
    heartbeatTimeout: "20 seconds",
    retry: {
      initialInterval: "2 seconds",
      maximumInterval: "30 seconds",
      maximumAttempts: 10,
    },
  });
  await application.publishCustomNight(input);
}
