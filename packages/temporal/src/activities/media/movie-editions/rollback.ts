import { Context } from "@temporalio/activity";
import type { MovieFileActivitiesV4 } from "@shepherdjerred/media/movie-lifecycle";
import type { createMediaFileRuntime } from "@shepherdjerred/media/automation/network";
import { PublicationAuthorityReadBudget } from "@shepherdjerred/media/publication-authority-budget";
import { compensationCall } from "#activities/media/compensation-execution.ts";

type Runtime = Pick<
  Awaited<ReturnType<typeof createMediaFileRuntime>>,
  "movie"
>;
type Method = "prepareMovieRollbackV4" | "rollbackMoviePublicationV4";

/** Owner and original SDK capability precede runtime/configuration loading.
 * Admission and native inverse are separate durable Activities. */
export function createMovieRollbackFileWorkerActivitiesV4(
  load: () => Promise<Runtime>,
): Pick<MovieFileActivitiesV4, Method> {
  function invoke<T>(
    method: Method,
    input: Parameters<MovieFileActivitiesV4[Method]>[0],
    dispatch: (
      movie: Runtime["movie"],
      ...args: Parameters<Runtime["movie"]["prepareMovieRollbackV4"]>
    ) => Promise<T>,
  ) {
    const observed = { wall: Date.now(), monotonic: performance.now() };
    const budget = new PublicationAuthorityReadBudget();
    return compensationCall(async (sdk) => {
      const info = Context.current().info;
      if (info.workflowExecution === undefined)
        throw new Error("Movie rollback requires an actual Workflow Activity");
      const owner = {
        workflowId: info.workflowExecution.workflowId,
        runId: info.workflowExecution.runId,
        activityId: info.activityId,
      };
      const runtime = await load();
      sdk.assertActive();
      return dispatch(
        runtime.movie,
        input,
        {
          ...sdk,
          observed,
          checkpoint: () => sdk.checkpoint(method),
        },
        owner,
        budget,
      );
    });
  }
  return {
    prepareMovieRollbackV4: (input) =>
      invoke("prepareMovieRollbackV4", input, (movie, ...args) =>
        movie.prepareMovieRollbackV4(...args),
      ),
    rollbackMoviePublicationV4: (input) =>
      invoke("rollbackMoviePublicationV4", input, (movie, ...args) =>
        movie.rollbackMoviePublicationV4(...args),
      ),
  };
}
