import type { MediaAutomationContext } from "#automation/context.ts";
import type {
  MovieOperationV4,
  MovieAttemptOperationV4,
} from "#shared/movie-editions/automation-v4.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { MediaError } from "#application/errors.ts";
import { reconcileMovieIntentV4 } from "./reconcile.ts";
import { submitMovieTorrentV4 } from "./submission.ts";
import { observeMovieAcquisitionV4 } from "./observation.ts";
import { publishMoviePlexV4 } from "./plex-publication.ts";
import { finalizeMovieAcquisitionV4 } from "./finalization.ts";
import { findMovieSubtitlesV4 } from "./subtitles/network.ts";
import {
  defaultSources,
  type SubtitleSourceLoader,
} from "#automation/subtitles/providers.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import type { MovieSubtitleOperationV4 } from "#shared/movie-editions/subtitles-v4.ts";

/** Credentials may be cached; every dispatch supplies its original invocation capability. */
export function createMovieNetworkFacetV4(
  context: MediaAutomationContext,
  sources: Readonly<Record<string, SubtitleSourceLoader>> = defaultSources,
) {
  const invocation = (execution: PlexBindingExecution) => ({
    ...context,
    plexBindingExecution: () => execution,
  });
  return {
    async findMovieSubtitlesV4(
      input: MovieSubtitleOperationV4,
      execution: PlexBindingExecution,
    ) {
      try {
        return await findMovieSubtitlesV4(
          invocation(execution),
          input,
          sources,
        );
      } catch (error) {
        if (error instanceof MediaError)
          return {
            status: "blocked" as const,
            subtitleId: null,
            reason: error.code,
          };
        if (
          error instanceof FileGuardError ||
          error instanceof PlexBindingProtection
        )
          return {
            status: "blocked" as const,
            subtitleId: null,
            reason: error.reason,
          };
        throw error;
      }
    },
    async reconcileMovieIntentV4(
      input: MovieOperationV4,
      execution: PlexBindingExecution,
    ) {
      try {
        return await reconcileMovieIntentV4(invocation(execution), input);
      } catch (error) {
        if (error instanceof MediaError)
          return {
            status: "blocked" as const,
            attemptId: null,
            reason: error.code,
          };
        throw error;
      }
    },
    async submitMovieTorrentV4(
      input: MovieAttemptOperationV4,
      execution: PlexBindingExecution,
    ) {
      try {
        return await submitMovieTorrentV4(invocation(execution), input);
      } catch (error) {
        if (error instanceof MediaError)
          return { status: "blocked" as const, reason: error.code };
        throw error;
      }
    },
    async observeMovieAcquisitionV4(
      input: MovieAttemptOperationV4,
      execution: PlexBindingExecution,
    ) {
      try {
        return await observeMovieAcquisitionV4(invocation(execution), input);
      } catch (error) {
        if (error instanceof MediaError)
          return { status: "blocked" as const, reason: error.code };
        throw error;
      }
    },
    publishMovieToPlexV4: (
      input: MovieAttemptOperationV4,
      execution: PlexBindingExecution,
    ) => publishMoviePlexV4(context, input, execution),
    finalizeMovieAcquisitionV4: (
      input: MovieAttemptOperationV4,
      execution: PlexBindingExecution,
    ) => finalizeMovieAcquisitionV4(context, input, execution),
  };
}
