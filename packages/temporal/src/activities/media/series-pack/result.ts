import {
  ServiceError,
  isGrpcServiceError,
  isGrpcDeadlineError,
} from "@temporalio/client";
import type { TestWorkflowEnvironment } from "@temporalio/testing";

type Progress = { runId: string; eventId: bigint };

/** Reattach the same execution after one bounded long-poll expires. Actual
 * durable progress is required; Activity and storage clocks are never renewed. */
export async function seriesPackRoleResult(input: {
  environment: TestWorkflowEnvironment;
  workflowId: string;
  caseDeadline: number;
}) {
  const progress = new Map<string, Progress>();
  await observeProgress(input, progress);
  const root = progress.get(input.workflowId);
  if (root === undefined) throw new Error("Actual role execution missing");
  const handle = input.environment.client.workflow.getHandle(
    input.workflowId,
    root.runId,
    { followRuns: false },
  );
  while (Date.now() < input.caseDeadline) {
    try {
      const result: unknown =
        await input.environment.client.connection.withDeadline(
          Math.min(Date.now() + 20_000, input.caseDeadline),
          () => handle.result(),
        );
      return result;
    } catch (error) {
      if (
        !(error instanceof ServiceError) ||
        !isGrpcServiceError(error.cause) ||
        !isGrpcDeadlineError(error.cause)
      )
        throw error;
      if (!(await observeProgress(input, progress)))
        throw new Error(
          "Actual series pack role made no durable history progress",
          { cause: error },
        );
    }
  }
  throw new Error("Actual series pack role exceeded its original case budget");
}

async function observeProgress(
  input: {
    environment: TestWorkflowEnvironment;
    workflowId: string;
    caseDeadline: number;
  },
  progress: Map<string, Progress>,
) {
  const pending = [input.workflowId];
  const seen = new Set<string>();
  let changed = false;
  while (pending.length > 0) {
    const workflowId = pending.shift();
    if (workflowId === undefined || seen.has(workflowId)) continue;
    seen.add(workflowId);
    if (seen.size > 4)
      throw new Error(
        "Actual series pack role tree exceeded its bounded scope",
      );
    const description = await input.environment.client.connection.withDeadline(
      Math.min(Date.now() + 20_000, input.caseDeadline),
      () => input.environment.client.workflow.getHandle(workflowId).describe(),
    );
    const before = progress.get(workflowId);
    if (before !== undefined && before.runId !== description.runId)
      throw new Error("Actual series pack role changed its recorded execution");
    const history = await input.environment.client.connection.withDeadline(
      Math.min(Date.now() + 20_000, input.caseDeadline),
      () =>
        input.environment.client.workflow
          .getHandle(workflowId, description.runId)
          .fetchHistory(),
    );
    const last = history.events?.at(-1)?.eventId;
    if (last == null)
      throw new Error("Actual role history omitted its durable event identity");
    const eventId = BigInt(last.toString());
    changed ||= before === undefined || eventId > before.eventId;
    progress.set(workflowId, { runId: description.runId, eventId });
    for (const event of history.events ?? []) {
      const child =
        event.childWorkflowExecutionStartedEventAttributes?.workflowExecution
          ?.workflowId;
      if (child != null) pending.push(child);
    }
  }
  return changed;
}
