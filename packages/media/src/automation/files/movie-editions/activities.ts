import type { FileContext } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { MediaError } from "#application/errors.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import type { PublicationExecution } from "#automation/publication-proof/invocation.ts";
import type {
  MovieAttemptOperationV4,
  MovieDecisionOperationV4,
  MovieOperationV4,
} from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { inspectAndStageMovieV4 } from "./inspection.ts";
import { prepareMoviePublicationV4, promoteMovieV4 } from "./publication.ts";
import { installMovieSubtitlesV4 } from "./subtitles.ts";
import type { MovieSubtitleInstallV4 } from "#shared/movie-editions/subtitles-v4.ts";
import { quarantineMovieFilesV4 } from "#automation/movie-editions/retention/quarantine.ts";
import { purgeMovieFilesV4 } from "#automation/movie-editions/retention/purge.ts";
import { restoreMovieFilesV4 } from "#automation/movie-editions/retention/restore.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { MovieRollbackExecution } from "#shared/movie-editions/rollback/execution.ts";
import { prepareMovieRollbackV4 } from "./rollback/preparation.ts";
import { rollbackMoviePublicationV4 } from "./rollback/publication.ts";
import { createRequestedMovieRollbackFileFacetV1 } from "./rollback/manual-facet.ts";

export function createMovieFileFacetV4(context: FileContext) {
  return {
    ...createRequestedMovieRollbackFileFacetV1(context),
    prepareMovieRollbackV4(
      input: MovieAttemptOperationV4,
      execution: PublicationExecution,
      owner: MovieRollbackExecution,
      budget: PublicationAuthorityReadBudget,
    ) {
      return prepareMovieRollbackV4(
        {
          ...context,
          publicationExecution: () => execution,
          movieRollbackExecution: owner,
          movieManagement: { execution, budget },
        },
        input,
      );
    },
    rollbackMoviePublicationV4(
      input: MovieAttemptOperationV4,
      execution: PublicationExecution,
      owner: MovieRollbackExecution,
      budget: PublicationAuthorityReadBudget,
    ) {
      return rollbackMoviePublicationV4(
        {
          ...context,
          publicationExecution: () => execution,
          movieRollbackExecution: owner,
          movieManagement: { execution, budget },
        },
        input,
      );
    },
    async prepareMoviePublicationV4(
      input: MovieAttemptOperationV4,
      execution: PublicationExecution,
      budget: PublicationAuthorityReadBudget,
    ) {
      try {
        await prepareMoviePublicationV4(
          { ...context, publicationExecution: () => execution },
          input,
          budget,
        );
        return { status: "prepared" as const };
      } catch (error) {
        return blockedMovieFile(error);
      }
    },
    async restoreMovieFilesV4(
      input: MovieOperationV4,
      execution: PublicationExecution,
    ) {
      try {
        await restoreMovieFilesV4(
          retentionInvocation(context, execution),
          input,
        );
        return { status: "restored" as const };
      } catch (error) {
        const blocked = blockedMovieFile(error);
        return { ...blocked, status: "protected" as const };
      }
    },
    async purgeMovieFilesV4(
      input: MovieDecisionOperationV4,
      execution: PublicationExecution,
    ) {
      try {
        await purgeMovieFilesV4(retentionInvocation(context, execution), input);
        return { status: "purged" as const };
      } catch (error) {
        const blocked = blockedMovieFile(error);
        return { ...blocked, status: "protected" as const };
      }
    },
    async quarantineMovieFilesV4(
      input: MovieDecisionOperationV4,
      execution: PublicationExecution,
    ) {
      try {
        await quarantineMovieFilesV4(
          retentionInvocation(context, execution),
          input,
        );
        return { status: "quarantined" as const };
      } catch (error) {
        const blocked = blockedMovieFile(error);
        return { ...blocked, status: "protected" as const };
      }
    },
    async installMovieSubtitlesV4(
      input: MovieSubtitleInstallV4,
      execution: PublicationExecution,
    ) {
      try {
        await installMovieSubtitlesV4(
          { ...context, publicationExecution: () => execution },
          input,
        );
        return { status: "installed" as const };
      } catch (error) {
        return blockedMovieFile(error);
      }
    },
    async inspectAndStageMovieV4(
      input: MovieAttemptOperationV4,
      execution: PublicationExecution,
    ) {
      try {
        await inspectAndStageMovieV4(
          { ...context, publicationExecution: () => execution },
          input,
        );
        return { status: "staged" as const };
      } catch (error) {
        return blockedMovieFile(error);
      }
    },
    async promoteMovieFilesV4(
      input: MovieAttemptOperationV4,
      execution: PublicationExecution,
    ) {
      try {
        await promoteMovieV4(
          { ...context, publicationExecution: () => execution },
          input,
        );
        return { status: "published" as const };
      } catch (error) {
        return blockedMovieFile(error);
      }
    },
  };
}

function retentionInvocation(
  context: FileContext,
  execution: PublicationExecution,
): FileContext {
  return {
    ...context,
    publicationExecution: () => execution,
    movieManagement: {
      execution,
      budget:
        context.movieManagement?.budget ?? new PublicationAuthorityReadBudget(),
    },
  };
}

function blockedMovieFile(error: unknown) {
  if (error instanceof FileOperationConflict)
    return {
      status: "blocked" as const,
      reason: "movie_file_operation_conflict",
    };
  if (error instanceof FileGuardError || error instanceof PlexBindingProtection)
    return { status: "blocked" as const, reason: error.reason };
  if (error instanceof MediaError)
    return { status: "blocked" as const, reason: error.code };
  throw error;
}
