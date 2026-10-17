import type { MediaAutomationContext } from "#automation/context.ts";
import { serializable } from "#automation/store.ts";
import { queueNativeArchiveCleanup } from "#infrastructure/native-archive/continuation.ts";
import { z } from "zod";
const ClosedStatus = z.enum([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TERMINATED",
  "TIMED_OUT",
]);

export async function queueNativeArchivePage(
  context: MediaAutomationContext,
  input: { cursor: string | null; scanId: string },
) {
  const runtime = await context.db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const records = await context.db.nativeArchiveCleanupContinuation.findMany({
    where: {
      recoveryEpoch: runtime.recoveryEpoch,
      state: { in: ["pending", "protected", "cleaning"] },
      ...(input.cursor === null ? {} : { id: { gt: input.cursor } }),
    },
    orderBy: { id: "asc" },
    take: 25,
  });
  for (const row of records) {
    let previousWorkflowClosed:
      | {
          operationId: string;
          workflowId: string;
          status: z.infer<typeof ClosedStatus>;
        }
      | undefined;
    if (row.coordinatorOperationId !== null) {
      const workflow = await context.describeWorkflow(
        `media-operation-${row.coordinatorOperationId}`,
      );
      const closed = ClosedStatus.safeParse(workflow?.status);
      if (!closed.success) continue;
      previousWorkflowClosed = {
        operationId: row.coordinatorOperationId,
        workflowId: `media-operation-${row.coordinatorOperationId}`,
        status: closed.data,
      };
      // A closed Workflow is not proof that an uncertain physical effect is settled.
      // The continuation service preserves protected execution/journal authority.
    }
    await serializable(context.db, (tx) =>
      queueNativeArchiveCleanup(tx, {
        continuationId: row.id,
        expectedVersion: row.version,
        scanId: input.scanId,
        ...(previousWorkflowClosed === undefined
          ? {}
          : { previousWorkflowClosed }),
      }),
    );
  }
  return {
    processed: records.length,
    nextCursor: records.length === 25 ? (records.at(-1)?.id ?? null) : null,
  };
}
