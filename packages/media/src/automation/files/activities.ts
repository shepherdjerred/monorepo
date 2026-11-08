import { MediaError } from "#application/errors.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";
import {
  assertHistoricalMovieRetention,
  HistoricalMovieRetentionProtection,
} from "#infrastructure/recovery/legacy-claims/historical-movie.ts";
import { MovieChoiceProtection } from "#infrastructure/movie-editions/errors.ts";
import type { MediaFileActivities } from "#shared/automation.ts";
import { FileGuardError, type FileContext } from "./types.ts";
import { inspectAndStage } from "./inspection.ts";
import { promote } from "./publication.ts";
import { prepareSeriesPackPublicationV1 } from "./series-pack/publication.ts";
import { createSeriesPackStagingFileFacetV1 } from "./series-pack/staging/facet.ts";
import { createSeriesPackBoundedPublicationActivitiesV1 } from "./series-pack/publication/activities.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { requirePublicationExecution } from "#automation/publication-proof/invocation.ts";
import { removeFiles } from "./removal.ts";
import { restoreFiles } from "./restoration.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { installSubtitle } from "./subtitles.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import { rollbackPromotion } from "./rollback.ts";
import { cleanupUpgrade } from "./upgrade-cleanup.ts";
import { compensateRejectedCut } from "./editions/recovery.ts";
import { compensateRejectedChoice } from "./editions/choice-recovery.ts";
import {
  LEGACY_CLAIM_PROTECTION,
  PendingLegacyClaimsError,
  reopenLegacyClaimProtection,
} from "#infrastructure/recovery/legacy-claims/protection.ts";

async function repairLegacyProtection(
  context: FileContext,
  error: unknown,
  budget: PublicationAuthorityReadBudget,
) {
  if (!(error instanceof PendingLegacyClaimsError)) return null;
  try {
    await reopenLegacyClaimProtection(
      context.db,
      error.mediaIds,
      (tx, mediaIds) =>
        assertHistoricalMovieRetention(tx, { mediaIds }, budget),
    );
    return LEGACY_CLAIM_PROTECTION;
  } catch (error_) {
    if (error_ instanceof HistoricalMovieRetentionProtection)
      return error_.reason;
    throw error_;
  }
}

/** Callbacks heartbeat and throw on Activity cancellation; only IDs leave the worker. */
export function createMediaFileActivities(
  context: FileContext,
): MediaFileActivities {
  const staging = createSeriesPackStagingFileFacetV1(context);
  return {
    ...createSeriesPackBoundedPublicationActivitiesV1(context),
    stageSeriesPackMembersV1: (input) => {
      const execution = requirePublicationExecution(
        context.publicationExecution?.(),
      );
      const budget =
        context.libraryManagement?.budget ??
        new PublicationAuthorityReadBudget();
      return staging.stageSeriesPackMembersV1(input, execution, budget);
    },
    sealSeriesPackStagingV1: (input) => {
      const execution = requirePublicationExecution(
        context.publicationExecution?.(),
      );
      const budget =
        context.libraryManagement?.budget ??
        new PublicationAuthorityReadBudget();
      return staging.sealSeriesPackStagingV1(input, execution, budget);
    },
    prepareSeriesPackPublication: async (input) => {
      try {
        await prepareSeriesPackPublicationV1(context, input);
        return { status: "prepared" };
      } catch (error_) {
        const error = physicalError(error_);
        if (error instanceof FileGuardError)
          return {
            status: error.reason.includes("obsolete") ? "obsolete" : "blocked",
            reason: error.reason,
          };
        throw error;
      }
    },
    cleanupSupersededMediaFile: async ({ cleanupId, operationId }) => {
      const budget =
        context.movieManagement?.budget ??
        context.libraryManagement?.budget ??
        new PublicationAuthorityReadBudget();
      try {
        await cleanupUpgrade(context, cleanupId, operationId, budget);
        return { status: "purged" };
      } catch (error_) {
        const error = physicalError(error_);
        const repaired = await repairLegacyProtection(context, error, budget);
        if (repaired !== null) return { status: "protected", reason: repaired };
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
      } catch (error_) {
        const error = physicalError(error_);
        if (error instanceof FileGuardError)
          return { status: "protected", reason: error.reason };
        throw error;
      }
    },
    inspectAndStageMedia: async ({ attemptId }) => {
      try {
        await inspectAndStage(context, attemptId);
        return { status: "staged" };
      } catch (error_) {
        await compensateRejectedChoice(context, attemptId, error_);
        const error = physicalError(error_);
        await compensateRejectedCut(context, attemptId, error);
        if (error instanceof FileGuardError)
          return { status: "blocked", reason: error.reason };
        throw error;
      }
    },
    promoteMediaFiles: async ({ attemptId, operationId }) => {
      try {
        await promote(context, attemptId, { operationId });
        return { status: "published" };
      } catch (error_) {
        const error = physicalError(error_);
        await compensateRejectedCut(context, attemptId, error);
        if (error instanceof FileGuardError)
          return {
            status: error.reason.includes("obsolete") ? "obsolete" : "blocked",
            reason: error.reason,
          };
        throw error;
      }
    },
    quarantineMediaFiles: async ({ decisionId, operationId }) => {
      const budget =
        context.movieManagement?.budget ??
        context.libraryManagement?.budget ??
        new PublicationAuthorityReadBudget();
      try {
        await removeFiles(context, decisionId, operationId, {
          purge: false,
          budget,
        });
        return { status: "quarantined" };
      } catch (error_) {
        const error = physicalError(error_);
        const repaired = await repairLegacyProtection(context, error, budget);
        return protectedRemovalResult(error, repaired);
      }
    },
    purgeMediaFiles: async ({ decisionId, operationId }) => {
      const budget =
        context.movieManagement?.budget ??
        context.libraryManagement?.budget ??
        new PublicationAuthorityReadBudget();
      try {
        await removeFiles(context, decisionId, operationId, {
          purge: true,
          budget,
        });
        return { status: "purged" };
      } catch (error_) {
        const error = physicalError(error_);
        const repaired = await repairLegacyProtection(context, error, budget);
        return protectedRemovalResult(error, repaired);
      }
    },
    restoreMediaFiles: async ({ mediaId, operationId }) => {
      try {
        return {
          status: (await restoreFiles(context, mediaId, operationId))
            ? "restored"
            : "missing",
        };
      } catch (error_) {
        const error = physicalError(error_);
        if (error instanceof FileGuardError)
          return { status: "protected", reason: error.reason };
        throw error;
      }
    },
    installMediaSubtitles: async ({ subtitleId, operationId }) => {
      try {
        await installSubtitle(context, subtitleId, operationId);
        return { status: "installed" };
      } catch (error_) {
        const error = physicalError(error_);
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

function physicalError(error: unknown): unknown {
  if (error instanceof NativeArchiveScopeProtection)
    return new FileGuardError(error.code);
  if (error instanceof HistoricalMovieRetentionProtection)
    return new FileGuardError(error.reason);
  if (error instanceof PlexBindingProtection)
    return new FileGuardError(error.reason);
  if (error instanceof MovieChoiceProtection)
    return new FileGuardError(error.code);
  return error instanceof MediaError &&
    ["lineage_unresolved", "edition_not_available"].includes(error.code)
    ? new FileGuardError(error.code)
    : error;
}

function protectedRemovalResult(
  error: unknown,
  repaired: string | null,
): { status: "protected"; reason: string } {
  if (repaired !== null) return { status: "protected", reason: repaired };
  if (error instanceof FileGuardError)
    return { status: "protected", reason: error.reason };
  throw error;
}
