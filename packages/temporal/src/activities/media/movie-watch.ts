import type { MovieWatchActivitiesV4 } from "@shepherdjerred/media/movie-lifecycle";
import type { createMediaNetworkRuntime } from "@shepherdjerred/media/automation/network";
import { plexBindingExecution } from "./plex-binding-execution.ts";
import { watchCall } from "./watch-execution.ts";

export function createMovieWatchWorkerActivitiesV4(
  load: () => Promise<
    Pick<Awaited<ReturnType<typeof createMediaNetworkRuntime>>, "movieWatch">
  >,
): MovieWatchActivitiesV4 {
  return {
    observeMoviePlexHintV4: (input) =>
      watchCall(async () => {
        const execution = plexBindingExecution();
        execution.assertActive();
        const runtime = await load();
        execution.assertActive();
        return runtime.movieWatch.observeMoviePlexHintV4(input, execution);
      }),
  };
}
