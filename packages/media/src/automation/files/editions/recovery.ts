import { CutReasonSchema } from "#shared/editions/evidence.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { preparePublicationProof } from "#automation/files/content-proof.ts";
import { recoverObsoletePublication } from "#automation/files/recovery.ts";
import {
  FileGuardError,
  FilePlanSchema,
  type FileContext,
} from "#automation/files/types.ts";

/** New eligibility must not strand a proven pre-commit filesystem effect. */
export async function compensateRejectedCut(
  context: FileContext,
  attemptId: string,
  error: unknown,
): Promise<void> {
  if (
    !(error instanceof FileGuardError) ||
    (!CutReasonSchema.safeParse(error.reason).success &&
      error.reason !== "edition_provenance_missing")
  )
    return;
  const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  if (
    attempt.filePlan === null ||
    attempt.state === "imported" ||
    attempt.state === "obsolete"
  )
    return;
  const plan = FilePlanSchema.parse(attempt.filePlan);
  const prepared = await preparePublicationProof(context, plan);
  await context.db.$transaction(
    async (tx) => {
      await lockAcquisitionMedia(tx, attempt.mediaIds);
      const current = await tx.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
      if (current.state === "imported" || current.state === "obsolete") return;
      if (
        JSON.stringify(FilePlanSchema.parse(current.filePlan)) !==
        JSON.stringify(plan)
      )
        throw new FileGuardError("recovery_plan_changed");
      await recoverObsoletePublication({
        context: prepared,
        tx,
        attemptId,
        plan,
      });
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}
