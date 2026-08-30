import {
  CancellationScope,
  isCancellation,
  setHandler,
} from "@temporalio/workflow";
import {
  ScoutInteractiveRunInputSchema,
  type InteractiveOutcome,
  type ScoutInteractiveRunInput,
} from "#src/contracts.ts";
import { requestStopSignal } from "#src/signals.ts";
import { interactiveActivities } from "./activity-options.ts";
import { setWorkflowPhase } from "#src/workflow-ui-interceptor.ts";

export async function scoutInteractiveRunWorkflow(
  rawInput: ScoutInteractiveRunInput,
): Promise<InteractiveOutcome> {
  const input = ScoutInteractiveRunInputSchema.parse(rawInput);
  const activities = interactiveActivities(input.stage);
  let stopRequested = false;
  let cancelActivity: (() => void) | undefined;
  let outcome: InteractiveOutcome = {
    status: "failed",
    partialOutputAvailable: false,
  };
  let failed = false;
  let failure: unknown;

  setHandler(requestStopSignal, () => {
    stopRequested = true;
    cancelActivity?.();
  });

  try {
    setWorkflowPhase("**Phase:** running interactive analysis");
    outcome = await CancellationScope.cancellable(async () => {
      const scope = CancellationScope.current();
      cancelActivity = () => {
        scope.cancel();
      };
      if (stopRequested) scope.cancel();
      return await activities.runInteractive(input);
    });
  } catch (error: unknown) {
    if (isCancellation(error)) {
      outcome = { status: "cancelled", partialOutputAvailable: false };
    } else {
      failed = true;
      failure = error;
    }
  } finally {
    setWorkflowPhase("**Phase:** persisting the interactive outcome");
    await CancellationScope.nonCancellable(async () => {
      outcome = await activities.persistInteractiveOutcome({
        ...input,
        outcome,
      });
    });
  }

  if (failed) throw failure;
  return outcome;
}
