import type { Database } from "#infrastructure/database.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { MediaError } from "#application/errors.ts";

export async function assertReplacementCoordinatorTerminal(
  db: Database,
  describe: MediaAutomationContext["describeWorkflow"],
  replacementId: string,
) {
  const row = await db.subtitleReplacement.findUniqueOrThrow({
    where: { id: replacementId },
  });
  const operations = await db.operation.findMany({
    where: {
      targetId: replacementId,
      kind: {
        in: [
          "prepare_subtitle_replacement",
          "apply_subtitle_replacement",
          "reconcile_subtitle_replacement",
        ],
      },
    },
    orderBy: { createdAt: "asc" },
    take: 101,
  });
  if (operations.length === 0 || operations.length > 100)
    throw new MediaError(
      "subtitle_replacement_history_protected",
      "Exact bounded coordinator history is required",
      409,
    );
  const executions = [];
  for (const operation of operations) {
    const observed = await describe(`media-operation-${operation.id}`);
    if (
      observed === null ||
      !["COMPLETED", "FAILED", "CANCELLED", "TERMINATED", "TIMED_OUT"].includes(
        observed.status,
      )
    )
      throw new MediaError(
        "subtitle_replacement_executor_active",
        "Prior replacement workflows must be confirmed terminal",
        409,
      );
    executions.push({
      operationId: operation.id,
      runId: observed.runId,
      status: observed.status,
    });
  }
  return { version: row.version, executions };
}
