import type { Info } from "@temporalio/activity";

export function workflowExecutionContext(info: Info): Record<string, string> {
  const execution = info.workflowExecution;

  if (execution === undefined) {
    return {};
  }

  return {
    workflowId: execution.workflowId,
    runId: execution.runId,
  };
}

export function requiredWorkflowId(info: Info): string {
  const execution = info.workflowExecution;

  if (execution === undefined) {
    throw new Error(
      "Temporal workflow execution is required for this activity",
    );
  }

  return execution.workflowId;
}
