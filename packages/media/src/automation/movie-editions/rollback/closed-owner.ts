import type { MediaAutomationContext } from "#automation/context.ts";
import type { MovieRollbackIntentV1 } from "#shared/movie-editions/rollback/physical.ts";
import { MovieRetryClosedWorkflowV1Schema } from "#shared/movie-editions/retry/v1.ts";
import type { MovieRollbackExecution } from "#shared/movie-editions/rollback/execution.ts";

type Execution = { assertActive: () => void };
type RollbackOwner = Pick<MovieRollbackIntentV1, "operationId" | "owner"> & {
  invocation: Pick<MovieRollbackIntentV1["invocation"], "mode" | "source">;
};

/** The actual owner run must match, not merely another terminal execution with
 * its Workflow ID. Unknown and active executions confer no takeover authority. */
export async function observeMovieRollbackClosedOwnerV1(
  describe: MediaAutomationContext["describeWorkflow"],
  intent: RollbackOwner,
  input: { execution: Execution; owner?: MovieRollbackExecution },
) {
  const owner = input.owner ?? intent.owner;
  const read = async (workflowId: string) => {
    input.execution.assertActive();
    let observed: Awaited<ReturnType<typeof describe>>;
    try {
      observed = await describe(workflowId);
    } catch {
      input.execution.assertActive();
      return { state: "unknown" as const };
    }
    input.execution.assertActive();
    if (observed === null) return { state: "unknown" as const };
    if (observed.status === "RUNNING") return { state: "running" as const };
    const closed = MovieRetryClosedWorkflowV1Schema.safeParse({
      workflowId,
      ...observed,
    });
    return closed.success
      ? { state: "closed" as const, observation: closed.data }
      : { state: "unknown" as const };
  };
  const actual = await read(owner.workflowId);
  if (actual.state !== "closed") return actual;
  if (actual.observation.runId !== owner.runId)
    return { state: "unknown" as const };
  if (
    owner.workflowId === `media-operation-${intent.operationId}` ||
    input.owner !== undefined
  )
    return {
      state: "closed" as const,
      owner: actual.observation,
      sourceRoot: null,
    };
  if (
    intent.invocation.mode !== "automatic_failed_plex" ||
    owner.workflowId !== `media-acquire-${intent.invocation.source.attemptId}`
  )
    throw new Error(
      "Movie rollback owner is not its actual original root or acquisition child",
    );
  const root = await read(
    `media-operation-${intent.invocation.source.operationId}`,
  );
  return root.state === "closed"
    ? {
        state: "closed" as const,
        owner: actual.observation,
        sourceRoot: root.observation,
      }
    : root;
}
