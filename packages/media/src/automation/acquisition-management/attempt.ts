import type { AcquisitionAttempt, Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { MediaError } from "#application/errors.ts";
import { serializable } from "#automation/store.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { assertAttemptIdentity } from "#infrastructure/acquisition-identity/authority.ts";
import { GenerationsSchema } from "#shared/file-plan.ts";
import { protectLibraryManagement } from "#infrastructure/acquisition-identity/library-management.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";

type Context = Pick<
  MediaAutomationContext,
  "db" | "serverMachineId" | "libraryManagement"
>;

/** Exact captured management policy is rechecked; a changed generation is never adopted into an old birth. */
export async function validManagedAttempt(
  context: Context,
  attempt: AcquisitionAttempt,
) {
  try {
    return await serializable(context.db, async (tx) => {
      await lockAcquisitionMedia(tx, attempt.mediaIds);
      await assertNoPublicationCompensationFence(tx, {
        mediaIds: attempt.mediaIds,
      });
      if (!(await lockRuntimeAuthority(tx, attempt.recoveryEpoch)))
        return false;
      const current = await tx.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      return managedAttemptAuthority(tx, context, current);
    });
  } catch (error) {
    if (
      !(error instanceof MediaError) ||
      error.code !== "library_management_unconfirmed"
    )
      throw error;
    await serializable(context.db, async (tx) => {
      await lockAcquisitionMedia(tx, attempt.mediaIds);
      if (!(await lockRuntimeAuthority(tx, attempt.recoveryEpoch))) return;
      const current = await tx.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      await releaseKnownManagedReservation(tx, current);
    });
    return false;
  }
}

/** Caller owns complete canonical/target/runtime locks. Recovery and new effects retain the same captured policy. */
export async function managedAttemptAuthority(
  tx: Prisma.TransactionClient,
  context: Context,
  attempt: AcquisitionAttempt,
) {
  if (
    ["failed", "cancelled", "obsolete", "rejected", "completed"].includes(
      attempt.state,
    )
  )
    return false;
  const invocation = context.libraryManagement;
  if (invocation === undefined)
    throw new Error("Managed TV recovery needs its original invocation");
  await bindPlexTransactionDeadline(tx, invocation.freshness);
  const reservations = await tx.acquisitionReservation.findMany({
    where: { attemptId: attempt.id },
  });
  const generations = GenerationsSchema.parse(attempt.generations);
  if (
    reservations.length !== attempt.mediaIds.length ||
    reservations.some(
      (reservation) =>
        reservation.edition !== "default" ||
        !attempt.mediaIds.includes(reservation.mediaId) ||
        reservation.generation !== generations[reservation.mediaId],
    )
  )
    protectLibraryManagement();
  await assertAttemptIdentity(tx, attempt, {
    serverMachineId: context.serverMachineId,
    libraryManagement: invocation,
  });
  invocation.freshness.assertActive();
  return true;
}

export async function releaseKnownManagedReservation(
  tx: Prisma.TransactionClient,
  attempt: AcquisitionAttempt,
) {
  if (
    attempt.filePlan !== null ||
    ["submitting", "submission_unknown", "imported", "completed"].includes(
      attempt.state,
    )
  )
    return;
  if (attempt.state !== "cancelled")
    await tx.acquisitionAttempt.update({
      where: { id: attempt.id },
      data: { state: "cancelled" },
    });
  await tx.acquisitionReservation.deleteMany({
    where: {
      attemptId: attempt.id,
      edition: "default",
      mediaId: { in: attempt.mediaIds },
    },
  });
}

/** Seeding was recorded in a preceding transaction; projection failure cannot roll that responsibility back. */
export async function projectManagedSubmission(
  context: Context,
  attempt: AcquisitionAttempt,
) {
  if (!(await validManagedAttempt(context, attempt))) return;
  await serializable(context.db, async (tx) => {
    await lockAcquisitionMedia(tx, attempt.mediaIds);
    await assertNoPublicationCompensationFence(tx, {
      mediaIds: attempt.mediaIds,
    });
    if (!(await lockRuntimeAuthority(tx, attempt.recoveryEpoch))) return;
    const current = await tx.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    if (["validating", "imported", "completed"].includes(current.state)) return;
    await assertAttemptIdentity(tx, current, {
      serverMachineId: context.serverMachineId,
      libraryManagement: context.libraryManagement,
    });
    await tx.acquisitionAttempt.update({
      where: { id: attempt.id },
      data: { state: "downloading" },
    });
    await tx.mediaIntent.updateMany({
      where: { edition: "default", mediaId: { in: attempt.mediaIds } },
      data: { availability: "downloading" },
    });
    await tx.mediaItem.updateMany({
      where: { id: { in: attempt.mediaIds } },
      data: { availability: "downloading" },
    });
    context.libraryManagement?.freshness.assertActive();
  });
}
