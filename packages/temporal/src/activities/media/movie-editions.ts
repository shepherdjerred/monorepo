import type {
  MovieNetworkActivitiesV4,
  MovieFileActivitiesV4,
} from "@shepherdjerred/media/movie-lifecycle";
import type {
  createMediaNetworkRuntime,
  createMediaFileRuntime,
} from "@shepherdjerred/media/automation/network";
import { plexBindingCall } from "./plex-binding-execution.ts";
import { compensationCall } from "./compensation-execution.ts";

/** Original SDK capability precedes even a cold runtime/configuration load. */
export function createMovieNetworkWorkerActivitiesV4(
  load: () => Promise<
    Pick<Awaited<ReturnType<typeof createMediaNetworkRuntime>>, "movie">
  >,
): MovieNetworkActivitiesV4 {
  return {
    findMovieSubtitlesV4: (input) =>
      plexBindingCall(async (execution) => {
        const runtime = await load();
        execution.assertActive();
        return runtime.movie.findMovieSubtitlesV4(input, execution);
      }),
    reconcileMovieIntentV4: (input) =>
      plexBindingCall(async (execution) => {
        const runtime = await load();
        execution.assertActive();
        return runtime.movie.reconcileMovieIntentV4(input, execution);
      }),
    submitMovieTorrentV4: (input) =>
      plexBindingCall(async (execution) => {
        const runtime = await load();
        execution.assertActive();
        return runtime.movie.submitMovieTorrentV4(input, execution);
      }),
    observeMovieAcquisitionV4: (input) =>
      plexBindingCall(async (execution) => {
        const runtime = await load();
        execution.assertActive();
        return runtime.movie.observeMovieAcquisitionV4(input, execution);
      }),
    publishMovieToPlexV4: (input) =>
      plexBindingCall(async (execution) => {
        const runtime = await load();
        execution.assertActive();
        return runtime.movie.publishMovieToPlexV4(input, execution);
      }),
    finalizeMovieAcquisitionV4: (input) =>
      plexBindingCall(async (execution) => {
        const runtime = await load();
        execution.assertActive();
        return runtime.movie.finalizeMovieAcquisitionV4(input, execution);
      }),
  };
}

export function createMovieFileWorkerActivitiesV4(
  load: () => Promise<
    Pick<Awaited<ReturnType<typeof createMediaFileRuntime>>, "movie">
  >,
): MovieFileActivitiesV4 {
  return {
    installMovieSubtitlesV4: (input) => {
      const observed = { wall: Date.now(), monotonic: performance.now() };
      return compensationCall(async (sdk) => {
        const runtime = await load();
        sdk.assertActive();
        return runtime.movie.installMovieSubtitlesV4(input, {
          ...sdk,
          observed,
          checkpoint: () => sdk.checkpoint("movie-subtitle-install"),
        });
      });
    },
    inspectAndStageMovieV4: (input) => {
      const observed = { wall: Date.now(), monotonic: performance.now() };
      return compensationCall(async (sdk) => {
        const runtime = await load();
        sdk.assertActive();
        return runtime.movie.inspectAndStageMovieV4(input, {
          ...sdk,
          observed,
          checkpoint: () => sdk.checkpoint("movie-inspection"),
        });
      });
    },
    promoteMovieFilesV4: (input) => {
      const observed = { wall: Date.now(), monotonic: performance.now() };
      return compensationCall(async (sdk) => {
        const runtime = await load();
        sdk.assertActive();
        return runtime.movie.promoteMovieFilesV4(input, {
          ...sdk,
          observed,
          checkpoint: () => sdk.checkpoint("movie-publication"),
        });
      });
    },
  };
}
