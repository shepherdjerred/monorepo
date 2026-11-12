import type { MediaAutomationContext } from "#automation/context.ts";
import type { FileContext } from "#automation/files/types.ts";
import type {
  MediaFileActivities,
  MediaOperation,
  MediaAttemptOperation,
} from "#shared/automation.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PublicationExecution } from "#automation/publication-proof/invocation.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { createSeriesPackPublicationFileFacet } from "#automation/files/series-pack/publication-facet.ts";
import { createSeriesPackStagingFileFacetV1 } from "#automation/files/series-pack/staging/facet.ts";
import { createSeriesPackBoundedPublicationFileFacetV1 } from "#automation/files/series-pack/publication/facet.ts";

/** Original SDK capabilities stay process-local and precede cold runtime loading. */
export function createAcquisitionNetworkFacet(context: MediaAutomationContext) {
  const invocation = (execution: PlexBindingExecution) => {
    execution.assertActive();
    return createAcquisitionActivities({
      ...context,
      plexBindingExecution: () => execution,
    });
  };
  return {
    reconcileMediaIntent: (
      input: MediaOperation,
      execution: PlexBindingExecution,
    ) => invocation(execution).reconcileMediaIntent(input),
    submitMediaTorrent: (
      input: MediaAttemptOperation,
      execution: PlexBindingExecution,
    ) => invocation(execution).submitMediaTorrent(input),
    observeMediaAcquisition: (
      input: MediaAttemptOperation,
      execution: PlexBindingExecution,
    ) => invocation(execution).observeMediaAcquisition(input),
  };
}

export function createAcquisitionFileFacet(context: FileContext) {
  const invocation = (execution: PublicationExecution) => {
    execution.assertActive();
    return createMediaFileActivities({
      ...context,
      publicationExecution: () => execution,
    });
  };
  return {
    ...createSeriesPackStagingFileFacetV1(context),
    ...createSeriesPackBoundedPublicationFileFacetV1(context),
    prepareSeriesPackPublication: createSeriesPackPublicationFileFacet(context),
    cleanupSupersededMediaFile: (
      input: Parameters<MediaFileActivities["cleanupSupersededMediaFile"]>[0],
      execution: PublicationExecution,
    ) => invocation(execution).cleanupSupersededMediaFile(input),
    inspectAndStageMedia: (
      input: Parameters<MediaFileActivities["inspectAndStageMedia"]>[0],
      execution: PublicationExecution,
    ) => invocation(execution).inspectAndStageMedia(input),
    promoteMediaFiles: (
      input: MediaAttemptOperation,
      execution: PublicationExecution,
    ) => invocation(execution).promoteMediaFiles(input),
  };
}
