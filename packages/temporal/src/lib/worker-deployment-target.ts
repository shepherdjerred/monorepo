import { z } from "zod";

export const WorkerDeploymentRolloutTargetSchema = z.enum([
  "central",
  "scout-beta",
  "scout-prod",
]);

export type WorkerDeploymentRolloutTargetConfiguration = {
  deploymentName: string;
  rolloutLockName: string;
  taskQueue: string;
  candidatePinName: string;
  stablePinName: string;
  imageRepository: string;
  replayCommands: readonly (readonly string[])[];
  canaryCommand: readonly string[];
  acceptancePrerequisite?: {
    namespace: string;
    deploymentName: string;
    taskQueue: string;
  };
};

export function resolveWorkerDeploymentRolloutTarget(
  rawTarget: string,
  address: string,
): WorkerDeploymentRolloutTargetConfiguration {
  const target = WorkerDeploymentRolloutTargetSchema.parse(rawTarget);
  if (target === "central") {
    return {
      deploymentName: "monorepo-central-workflows",
      rolloutLockName: "monorepo-central-workflows",
      taskQueue: "monorepo-workflows",
      candidatePinName: "shepherdjerred/temporal-worker/workflows/candidate",
      stablePinName: "shepherdjerred/temporal-worker/workflows/stable",
      imageRepository: "docker.io/shepherdjerred/temporal-worker",
      replayCommands: [
        ["bun", "run", "test:workflows"],
        ["bun", "run", "replay:candidate-histories"],
      ],
      canaryCommand: [
        "bun",
        "run",
        "scripts/rollout/worker-deployment-canary.ts",
      ],
    };
  }
  const stage = target === "scout-beta" ? "beta" : "prod";
  const scoutTemporalDirectory = "../scout-for-lol/packages/temporal";
  return {
    deploymentName: `scout-${stage}-workflows`,
    rolloutLockName: "scout-workflows",
    taskQueue: `scout-${stage}`,
    candidatePinName: `shepherdjerred/scout-for-lol/${stage}/workflows/candidate`,
    stablePinName: `shepherdjerred/scout-for-lol/${stage}/workflows/stable`,
    imageRepository: "docker.io/shepherdjerred/scout-for-lol",
    replayCommands: [
      ["bun", "run", "--cwd", scoutTemporalDirectory, "test:workflows"],
      [
        "bun",
        "run",
        "--cwd",
        scoutTemporalDirectory,
        "replay:candidate-histories",
        "--stage",
        stage,
      ],
    ],
    canaryCommand: [
      "bun",
      "run",
      `${scoutTemporalDirectory}/scripts/run-canary.ts`,
      "--stage",
      stage,
      "--address",
      address,
    ],
    ...(stage === "prod"
      ? {
          acceptancePrerequisite: {
            namespace: "beta",
            deploymentName: "scout-beta-workflows",
            taskQueue: "scout-beta",
          },
        }
      : {}),
  };
}
