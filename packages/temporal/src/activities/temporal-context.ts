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
