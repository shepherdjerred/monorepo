import { Context } from "@temporalio/activity";
import type {
  RequestedMovieRollbackFileActivitiesV1,
  RequestedMovieRollbackNetworkActivitiesV1,
} from "@shepherdjerred/media/movie-rollback";
import type {
  createMediaFileRuntime,
  createMediaNetworkRuntime,
} from "@shepherdjerred/media/automation/network";
import { PublicationAuthorityReadBudget } from "@shepherdjerred/media/publication-authority-budget";
import { compensationCall } from "#activities/media/compensation-execution.ts";
import { plexBindingCall } from "#activities/media/plex-binding-execution.ts";

type FileRuntime = Pick<
  Awaited<ReturnType<typeof createMediaFileRuntime>>,
  "movie"
>;
type NetworkRuntime = Pick<
  Awaited<ReturnType<typeof createMediaNetworkRuntime>>,
  "movie"
>;
type FileMethod = keyof RequestedMovieRollbackFileActivitiesV1;
type NetworkMethod = keyof RequestedMovieRollbackNetworkActivitiesV1;

/** Each actual Activity captures one original capability before lazy loading. */
export function createRequestedMovieRollbackFileWorkerActivitiesV1(
  load: () => Promise<FileRuntime>,
): RequestedMovieRollbackFileActivitiesV1 {
  function invoke<T>(
    method: FileMethod,
    input: Parameters<RequestedMovieRollbackFileActivitiesV1[FileMethod]>[0],
    dispatch: (
      movie: FileRuntime["movie"],
      ...args: Parameters<
        FileRuntime["movie"]["prepareRequestedMovieRollbackV1"]
      >
    ) => Promise<T>,
  ) {
    const observed = { wall: Date.now(), monotonic: performance.now() };
    const budget = new PublicationAuthorityReadBudget();
    return compensationCall(async (sdk) => {
      const info = Context.current().info;
      if (info.workflowExecution === undefined)
        throw new Error(
          "Requested movie rollback requires an actual Workflow Activity",
        );
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
    prepareRequestedMovieRollbackV1: (input) =>
      invoke("prepareRequestedMovieRollbackV1", input, (movie, ...args) =>
        movie.prepareRequestedMovieRollbackV1(...args),
      ),
    rollbackRequestedMoviePublicationV1: (input) =>
      invoke("rollbackRequestedMoviePublicationV1", input, (movie, ...args) =>
        movie.rollbackRequestedMoviePublicationV1(...args),
      ),
  };
}

export function createRequestedMovieRollbackNetworkWorkerActivitiesV1(
  load: () => Promise<NetworkRuntime>,
): RequestedMovieRollbackNetworkActivitiesV1 {
  function invoke<T>(
    input: Parameters<
      RequestedMovieRollbackNetworkActivitiesV1[NetworkMethod]
    >[0],
    dispatch: (
      movie: NetworkRuntime["movie"],
      ...args: Parameters<
        NetworkRuntime["movie"]["observeRequestedMovieRollbackV1"]
      >
    ) => Promise<T>,
  ) {
    const budget = new PublicationAuthorityReadBudget();
    return plexBindingCall(async (execution) => {
      const info = Context.current().info;
      const owner =
        info.workflowExecution === undefined
          ? undefined
          : {
              workflowId: info.workflowExecution.workflowId,
              runId: info.workflowExecution.runId,
              activityId: info.activityId,
            };
      const runtime = await load();
      execution.assertActive();
      return dispatch(runtime.movie, input, execution, budget, owner);
    });
  }
  return {
    observeRequestedMovieRollbackV1: (input) =>
      invoke(input, (movie, ...args) =>
        movie.observeRequestedMovieRollbackV1(...args),
      ),
    verifyRequestedMovieRollbackV1: (input) =>
      invoke(input, (movie, ...args) =>
        movie.verifyRequestedMovieRollbackV1(...args),
      ),
  };
}
