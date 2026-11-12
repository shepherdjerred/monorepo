import { DefaultAcquisitionIdentitySchema } from "#shared/acquisition/library-management.ts";
import { fileIdentityEvidence, type IdentityTorrentFile } from "./evidence.ts";
import type { AcquisitionAttempt } from "#generated/prisma/client.ts";
import { FileGuardError } from "#automation/files/types.ts";

/** Preserve the exact optional historical evidence branch and strict new parser. */
export function inspectionIdentity(raw: unknown, file: IdentityTorrentFile) {
  const identity =
    raw === null ? null : DefaultAcquisitionIdentitySchema.parse(raw);
  const evidence =
    identity === null ? undefined : fileIdentityEvidence(identity, file);
  return { identity, evidence };
}

export function assertInspectionCoordinator(
  attempt: Pick<AcquisitionAttempt, "operationId" | "coordinatorOperationId">,
  expected: string | undefined,
) {
  if (
    expected !== undefined &&
    (attempt.coordinatorOperationId ?? attempt.operationId) !== expected
  )
    throw new FileGuardError("acquisition_obsolete");
}

export function assertInspectionCandidateCount(
  media: readonly { kind: string }[],
  count: number,
) {
  if (count === 0) throw new FileGuardError("video_missing");
  if (count !== 1 && media.some((item) => item.kind === "movie"))
    throw new FileGuardError("movie_files_ambiguous");
}

export function assertInspectionPlanPresent(
  plan: unknown,
  required: boolean | undefined,
) {
  if (plan === null && required === true)
    throw new FileGuardError("staging_plan_required");
}
