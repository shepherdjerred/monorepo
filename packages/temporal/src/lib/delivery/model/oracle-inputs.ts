import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import {
  AdmissionSnapshotSchema,
  type ColdStartSnapshot,
} from "@shepherdjerred/delivery/model-contract";

/** A suite's report lives in its workspace; the workspace is the report path's package. */
export function testWorkspace(resultPath: string): string {
  const match = /^(packages\/[a-z0-9-]+(?:\/packages\/[a-z0-9-]+)?)\//u.exec(
    resultPath,
  );
  const workspace = match?.[1];
  if (workspace === undefined)
    throw new Error(
      `Test report ${resultPath} lies outside a packages/<name> workspace`,
    );
  return workspace;
}

/** The runner image admission froze for the recipe's runner reference (A5, C2). */
export function frozenRunnerImage(
  current: DeploymentDetail,
  runner: { service: string; component: string },
): string {
  const admission = AdmissionSnapshotSchema.parse(
    current.deployment.admissionSnapshot,
  );
  const frozen = admission.runners.find(
    (entry) =>
      entry.service === runner.service && entry.component === runner.component,
  );
  if (frozen === undefined)
    throw new Error(
      `Admission froze no ${runner.service} ${runner.component} runner`,
    );
  return `${frozen.artifact.uri}@${frozen.artifact.digest}`;
}

export type ColdStartWrite = {
  deploymentId: string;
  fingerprint: string;
  snapshot: ColdStartSnapshot;
};
