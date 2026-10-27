import type { FileContext } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { MediaError } from "#application/errors.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import type { PublicationExecution } from "#automation/publication-proof/invocation.ts";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import { inspectAndStageMovieV4 } from "./inspection.ts";
import { promoteMovieV4 } from "./publication.ts";
import { installMovieSubtitlesV4 } from "./subtitles.ts";
import type { MovieSubtitleInstallV4 } from "#shared/movie-editions/subtitles-v4.ts";

export function createMovieFileFacetV4(context: FileContext) {
  return {
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
