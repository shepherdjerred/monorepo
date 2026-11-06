import { MovieRollbackOperationV1Schema } from "#shared/movie-editions/rollback/operation.ts";
import {
  MovieRollbackRetryOperationV1Schema,
  RequestedMovieRollbackRetryPayloadV1Schema,
} from "#shared/movie-editions/rollback/retry.ts";

/** The real command keeps its private review; Workflow history receives scoped IDs only. */
export function requestedMovieRollbackOutboxInputV1(
  payload: Readonly<Record<string, unknown>>,
  operationId: string,
) {
  if ("resume" in payload) {
    const command = RequestedMovieRollbackRetryPayloadV1Schema.parse(payload);
    if (command.operationId !== operationId)
      throw new Error(
        "Movie rollback retry outbox changed its actual owner command",
      );
    return MovieRollbackRetryOperationV1Schema.parse({
      schemaVersion: command.schemaVersion,
      operationId: command.operationId,
      sourceAttemptId: command.sourceAttemptId,
      scope: command.scope,
      resume: command.resume,
    });
  }
  const input = MovieRollbackOperationV1Schema.parse({
    schemaVersion: payload["schemaVersion"],
    operationId: payload["operationId"],
    sourceAttemptId: payload["sourceAttemptId"],
    scope: payload["scope"],
  });
  if (input.operationId !== operationId)
    throw new Error("Movie rollback outbox changed its actual owner command");
  return input;
}
