import { ApplicationFailure } from "@temporalio/activity";

const conflictCodes = new Map([
  ["Unproven import partial requires recovery", "staging_partial_unproven"],
  [
    "Unacknowledged staged artifact requires recovery",
    "staging_artifact_unacknowledged",
  ],
  [
    "Prepared import partial identity changed",
    "staging_partial_identity_changed",
  ],
  ["Prepared import journal changed", "staging_journal_changed"],
  ["Prepared import content changed", "staging_content_changed"],
  [
    "Operation identifier was reused with different inputs",
    "staging_operation_reused",
  ],
  ["Content proof is unsealed or expired", "content_proof_expired"],
  ["Filesystem path has no preverified content proof", "content_proof_missing"],
  ["Copy source checksum changed", "copy_source_checksum_changed"],
  [
    "Media file identity changed during verification",
    "native_file_identity_changed",
  ],
  [
    "Media file identity changed after verification",
    "native_file_identity_changed",
  ],
  ["Copy ancestor identity changed", "native_ancestor_identity_changed"],
]);
const reasons = new Set([
  "publication_authority_expired",
  "publication_storage_authority_expired",
  "runtime_protected",
  "acquisition_obsolete",
  "intent_obsolete",
  "reservation_obsolete",
  "request_obsolete",
  "plex_library_access_required",
  "staging_plan_required",
  "staging_plan_changed",
  "staging_batch_scope_invalid",
]);
const errnos = new Set([
  "EIO",
  "ENOSPC",
  "EROFS",
  "EACCES",
  "EPERM",
  "ENOENT",
  "EEXIST",
  "ECANCELED",
  "ENOTDIR",
  "ELOOP",
  "EXDEV",
  "EMFILE",
  "ENFILE",
]);

/** Only finite diagnostic vocabulary crosses history; private error data never does. */
export function compensationDiagnostic(error: unknown) {
  if (!(error instanceof Error)) return;
  if (error instanceof ApplicationFailure) {
    if (error.type === "CompensationDeadlineExceeded")
      return { schemaVersion: 1, code: "sdk_deadline_exceeded" };
    if (error.type === "MediaPublicationInvocationExpired")
      return { schemaVersion: 1, code: "publication_invocation_expired" };
  }
  if (error.name === "FileOperationConflict")
    return {
      schemaVersion: 1,
      code: conflictCodes.get(error.message) ?? "file_operation_conflict",
    };
  if (
    error.name === "FileGuardError" &&
    "reason" in error &&
    typeof error.reason === "string" &&
    reasons.has(error.reason)
  )
    return {
      schemaVersion: 1,
      code: "file_guard_rejected",
      reason: error.reason,
    };
  return "code" in error &&
    typeof error.code === "string" &&
    errnos.has(error.code)
    ? { schemaVersion: 1, code: "filesystem_error", errno: error.code }
    : undefined;
}
