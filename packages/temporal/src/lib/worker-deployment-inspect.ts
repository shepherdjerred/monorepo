import { readWorkerDeploymentLock } from "./worker-deployment-lock.ts";
import {
  DeploymentDescriptionSchema,
  DeploymentNameSchema,
} from "./worker-deployment-schemas.ts";
import type { RolloutCommandRunner } from "./worker-deployment-proofs.ts";
import { temporalCommand } from "./worker-deployment-commands.ts";

type WorkerDeploymentInspectionOptions = {
  address: string;
  namespace: string;
  tls?: boolean;
  deploymentName: string;
  rolloutLockName?: string;
};

export type WorkerDeploymentRolloutInspection = {
  deploymentName: string;
  currentBuildId: string | undefined;
  rampingBuildId: string | undefined;
  rampPercentage: number;
  lastRampChange: string;
  rolloutLockObject: string | undefined;
};

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("worker deployment describe returned invalid JSON", {
      cause: error,
    });
  }
}

export async function inspectWorkerDeploymentRollout(
  options: WorkerDeploymentInspectionOptions,
  run: RolloutCommandRunner,
): Promise<WorkerDeploymentRolloutInspection> {
  const deploymentName = DeploymentNameSchema.parse(options.deploymentName);
  const [deploymentResult, rolloutLockObject] = await Promise.all([
    run(
      temporalCommand(options, [
        "worker",
        "deployment",
        "describe",
        "--name",
        deploymentName,
        "--output",
        "json",
      ]),
    ),
    readWorkerDeploymentLock(options.rolloutLockName ?? deploymentName, run),
  ]);
  const deployment = DeploymentDescriptionSchema.parse(
    parseJson(deploymentResult.stdout),
  );
  return {
    deploymentName: deployment.name,
    currentBuildId:
      deployment.routingConfig.currentVersionBuildID === ""
        ? undefined
        : deployment.routingConfig.currentVersionBuildID,
    rampingBuildId:
      deployment.routingConfig.rampingVersionBuildID === ""
        ? undefined
        : deployment.routingConfig.rampingVersionBuildID,
    rampPercentage: deployment.routingConfig.rampingVersionPercentage,
    lastRampChange:
      deployment.routingConfig.rampingVersionPercentageChangedTime,
    rolloutLockObject,
  };
}
