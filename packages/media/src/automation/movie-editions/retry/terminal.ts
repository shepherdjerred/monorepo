import type { MediaAutomationContext } from "#automation/context.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { MovieRetryClosedWorkflowV1Schema } from "#shared/movie-editions/retry/v1.ts";

/** A database status never proves that the predecessor's root and child executions have stopped. */
export async function movieRetryTerminalV1(
  context: MediaAutomationContext,
  input: {
    attemptId: string;
    previousCoordinatorOperationId: string;
    reservedWithoutTorrent: boolean;
  },
  execution: PlexBindingExecution,
) {
  const read = async (workflowId: string) => {
    execution.assertActive();
    execution.signal.throwIfAborted();
    const observation = await context.describeWorkflow(workflowId);
    execution.assertActive();
    execution.signal.throwIfAborted();
    if (observation === null) return null;
    const closed = MovieRetryClosedWorkflowV1Schema.safeParse({
      workflowId,
      ...observation,
    });
    return closed.success ? closed.data : null;
  };
  const root = await read(
    `media-operation-${input.previousCoordinatorOperationId}`,
  );
  if (root === null) return null;
  const workflowId = `media-acquire-${input.attemptId}`;
  execution.assertActive();
  const observedChild = await context.describeWorkflow(workflowId);
  execution.assertActive();
  execution.signal.throwIfAborted();
  if (observedChild === null)
    return input.reservedWithoutTorrent ? { root, child: null } : null;
  const child = MovieRetryClosedWorkflowV1Schema.safeParse({
    workflowId,
    ...observedChild,
  });
  return child.success ? { root, child: child.data } : null;
}
