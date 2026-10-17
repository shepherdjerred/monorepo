import type { MediaFileActivities } from "#shared/automation.ts";
import { FileGuardError, type FileContext } from "./types.ts";
import { inspectAndStage } from "./inspection.ts";
import { promote } from "./publication.ts";
import { removeFiles, restoreFiles } from "./removal.ts";
import { installSubtitle } from "./subtitles.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import { rollbackPromotion } from "./rollback.ts";
import { cleanupUpgrade } from "./upgrade-cleanup.ts";
import {
  LEGACY_CLAIM_PROTECTION,
  PendingLegacyClaimsError,
  reopenLegacyClaimProtection,
} from "#infrastructure/recovery/legacy-claims/protection.ts";

async function repairLegacyProtection(context: FileContext, error: unknown) {
  if (!(error instanceof PendingLegacyClaimsError)) return false;
  await reopenLegacyClaimProtection(context.db, error.mediaIds);
  return true;
}

/** Callbacks heartbeat and throw on Activity cancellation; only IDs leave the worker. */
export function createMediaFileActivities(
  context: FileContext,
): MediaFileActivities {
  return {
    cleanupSupersededMediaFile: async ({ cleanupId }) => {
      try {
        await cleanupUpgrade(context, cleanupId);
        return { status: "purged" };
      } catch (error) {
        if (await repairLegacyProtection(context, error))
          return { status: "protected", reason: LEGACY_CLAIM_PROTECTION };
        if (
          error instanceof FileGuardError &&
          error.reason === "cleanup_cancelled"
        )
          return { status: "obsolete", reason: error.reason };
        if (error instanceof FileGuardError)
          return { status: "protected", reason: error.reason };
        throw error;
      }
    },
    rollbackMediaPromotion: async ({ attemptId, operationId }) => {
      try {
        await rollbackPromotion(context, attemptId, operationId);
        return { status: "rolled_back" };
      } catch (error) {
        if (error instanceof FileGuardError)
          return { status: "protected", reason: error.reason };
        throw error;
      }
    },
    inspectAndStageMedia: async ({ attemptId }) => {
      try {
        await inspectAndStage(context, attemptId);
        return { status: "staged" };
      } catch (error) {
        if (error instanceof FileGuardError)
          return { status: "blocked", reason: error.reason };
        throw error;
      }
    },
    promoteMediaFiles: async ({ attemptId }) => {
      try {
        await promote(context, attemptId);
        return { status: "published" };
      } catch (error) {
        if (error instanceof FileGuardError)
          return {
            status: error.reason.includes("obsolete") ? "obsolete" : "blocked",
            reason: error.reason,
          };
        throw error;
      }
    },
    quarantineMediaFiles: async ({ decisionId, operationId }) => {
      try {
        await removeFiles(context, decisionId, operationId, false);
        return { status: "quarantined" };
      } catch (error) {
        if (await repairLegacyProtection(context, error))
          return { status: "protected", reason: LEGACY_CLAIM_PROTECTION };
        if (error instanceof FileGuardError)
          return { status: "protected", reason: error.reason };
        throw error;
      }
    },
    purgeMediaFiles: async ({ decisionId, operationId }) => {
      try {
        await removeFiles(context, decisionId, operationId, true);
        return { status: "purged" };
      } catch (error) {
        if (await repairLegacyProtection(context, error))
          return { status: "protected", reason: LEGACY_CLAIM_PROTECTION };
        if (error instanceof FileGuardError)
          return { status: "protected", reason: error.reason };
        throw error;
      }
    },
    restoreMediaFiles: async ({ mediaId, operationId }) => {
      try {
        return {
          status: (await restoreFiles(context, mediaId, operationId))
            ? "restored"
            : "missing",
        };
      } catch (error) {
        if (error instanceof FileGuardError)
          return { status: "protected", reason: error.reason };
        throw error;
      }
    },
    installMediaSubtitles: async ({ subtitleId, operationId }) => {
      try {
        await installSubtitle(context, subtitleId, operationId);
        return { status: "installed" };
      } catch (error) {
        if (error instanceof FileOperationConflict)
          return {
            status: "blocked",
            reason: "subtitle_path_requires_owner_review",
          };
        if (error instanceof FileGuardError) return { status: "obsolete" };
        throw error;
      }
    },
  };
}
