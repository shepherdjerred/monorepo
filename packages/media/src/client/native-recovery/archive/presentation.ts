import type { NativeArchiveFile } from "#shared/native-recovery/archive.ts";
import type { z } from "zod";
import type { NativeArchiveReasonSchema } from "#shared/native-recovery/archive-view.ts";

export const archiveRoles: Record<NativeArchiveFile["role"], string> = {
  selected_archive: "Selected for expiry cleanup",
  retained_archive: "Retained archive · not selected for deletion",
  current_playback: "Current playable version · retained",
};
export const archiveReasons: Record<
  z.infer<typeof NativeArchiveReasonSchema>,
  string
> = {
  archive_lineage_unresolved:
    "The original file relationship could not be verified.",
  archive_not_pending: "This original cleanup is no longer pending.",
  archive_checksum_missing: "The original checksum is missing.",
  archive_prior_grant_required:
    "An unchanged, previously approved physical version is required.",
  archive_current_continuation_exists:
    "This cleanup already has a current approved review.",
  archive_household_reconciliation_required:
    "Household recovery protection must be reconciled before cleanup.",
  archive_media_held: "A current Keep choice or pin protects these files.",
  archive_transition_reconciliation_required:
    "The playable version or archive evidence changed. This transition needs recovery support that is not available yet; another review cannot authorize it.",
};
export function archiveBytes(value: string): string {
  return `${BigInt(value).toLocaleString("en-US")} bytes`;
}
