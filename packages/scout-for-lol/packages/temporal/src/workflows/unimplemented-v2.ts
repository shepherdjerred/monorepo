import { ApplicationFailure } from "@temporalio/common";

/**
 * The body of every V2 Workflow until its implementation lane lands.
 *
 * The eight V2 types are registered now so the ID builders, contracts and
 * queue assignments are one frozen surface that three lanes can build against
 * in parallel. Registration without a body is a hazard, though: a Schedule
 * pointed at a V2 type, or an operator starting one by name, would otherwise
 * get an execution that completes having done nothing — the most expensive
 * kind of silence in a pipeline whose whole job is to be able to say what
 * happened.
 *
 * So a stub fails, terminally. `nonRetryable` because no amount of retrying
 * adds an implementation, and a Workflow failure rather than a Workflow task
 * failure because a task failure would retry forever and leave the execution
 * open and quiet instead of visibly failed.
 */
export function unimplementedV2Workflow(
  workflowType: string,
  contract: string,
): never {
  throw ApplicationFailure.nonRetryable(
    `Scout Workflow ${workflowType} is a registered V2 contract with no implementation yet (${contract})`,
    "UnimplementedWorkflow",
  );
}
