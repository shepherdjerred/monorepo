import { ApplicationFailure, workflowInfo } from "@temporalio/workflow";
import { WorkerBuildIdSchema } from "#shared/temporal-bootstrap.ts";

export type WorkerDeploymentCanaryInput = {
  deploymentName: string;
  buildId: string;
};

/**
 * Proves that a pinned start reached the exact candidate workflow bundle.
 * This intentionally has no Activities or payload-bearing output.
 */
export function workerDeploymentCanaryWorkflow(
  input: WorkerDeploymentCanaryInput,
): void {
  const expectedBuildId = WorkerBuildIdSchema.parse(input.buildId);
  const actual = workflowInfo().currentDeploymentVersion;
  if (
    actual?.deploymentName !== input.deploymentName ||
    actual.buildId !== expectedBuildId
  ) {
    throw ApplicationFailure.nonRetryable(
      "Worker Deployment canary reached an unexpected version",
      "WorkerDeploymentVersionMismatch",
    );
  }
}
