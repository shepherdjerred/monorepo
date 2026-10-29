import type { AcquisitionAttempt } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { managedSeriesIdentity } from "#shared/acquisition/library-management.ts";
import { readCompletedAcquisitionPlexPublication } from "#infrastructure/plex-binding/publication-receipt.ts";

/** A completed transfer retry acknowledges its exact immutable command; it cannot project downloading again. */
export async function acknowledgeManagedAcquisition(
  context: MediaAutomationContext,
  input: { operationId: string; attemptId: string },
  attempt: AcquisitionAttempt,
) {
  if (
    managedSeriesIdentity(attempt.identityEvidence) === null ||
    attempt.state !== "completed"
  )
    return false;
  const invocation = context.libraryManagement;
  if (invocation === undefined)
    throw new Error("Managed acknowledgement requires its original invocation");
  invocation.freshness.assertActive();
  const recorded = await readCompletedAcquisitionPlexPublication(
    context.db,
    input,
    invocation.budget,
  );
  invocation.freshness.assertActive();
  if (recorded === null)
    throw new Error(
      "Completed managed acquisition lost its immutable Plex receipt",
    );
  return true;
}
