import type {
  NativeArchiveScope,
  NativeArchiveNetworkEvidence,
} from "#shared/native-recovery/archive.ts";
import { ClosedCoordinatorObservationSchema } from "#shared/publication-proof/references.ts";
import { NativeArchiveProtection } from "#infrastructure/native-archive/continuation.ts";
import type { NativeArchiveExecution } from "#automation/native-archive/execution.ts";
import type { MediaAutomationContext } from "#automation/context.ts";

/** The optional branch is absent in original archive evidence and its hashes. */
export async function observeSupersededCoordinators(
  context: Pick<MediaAutomationContext, "describeWorkflow">,
  scope: Pick<NativeArchiveScope, "supersessions">,
  execution: NativeArchiveExecution,
) {
  if (scope.supersessions === undefined) return;
  const observed: NonNullable<
    NativeArchiveNetworkEvidence["supersededCoordinators"]
  > = [];
  for (const target of scope.supersessions) {
    execution.signal.throwIfAborted();
    execution.assertActive();
    const workflowId = `media-operation-${target.coordinatorOperationId}`;
    const description = await context.describeWorkflow(workflowId);
    execution.signal.throwIfAborted();
    execution.assertActive();
    const status = ClosedCoordinatorObservationSchema.shape.status.safeParse(
      description?.status,
    );
    if (
      description === null ||
      !status.success ||
      description.runId.length === 0
    )
      throw new NativeArchiveProtection(
        "native_archive_previous_workflow_not_closed",
      );
    observed.push({
      continuationId: target.continuationId,
      closedCoordinator: ClosedCoordinatorObservationSchema.parse({
        operationId: target.coordinatorOperationId,
        workflowId,
        runId: description.runId,
        status: status.data,
        observedAt: new Date().toISOString(),
      }),
    });
  }
  return observed;
}
