import { z } from "zod";

const NamespaceSchema = z.string().trim().min(1).max(255);
const WorkerDeploymentNameSchema = z.string().trim().min(1).max(127);
export const WorkerBuildIdSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "must be the exact lowercase image Git SHA");

const TemporalBootstrapEnvironmentSchema = z
  .object({
    TEMPORAL_NAMESPACE: NamespaceSchema.optional(),
    TEMPORAL_WORKER_DEPLOYMENT_NAME: WorkerDeploymentNameSchema.optional(),
    TEMPORAL_WORKER_BUILD_ID: WorkerBuildIdSchema.optional(),
    GIT_SHA: WorkerBuildIdSchema.or(z.literal("unknown")).optional(),
  })
  .loose()
  .superRefine((value, context) => {
    const hasDeployment = value.TEMPORAL_WORKER_DEPLOYMENT_NAME !== undefined;
    const hasBuild =
      value.TEMPORAL_WORKER_BUILD_ID !== undefined ||
      (hasDeployment &&
        value.GIT_SHA !== undefined &&
        value.GIT_SHA !== "unknown");
    if (hasDeployment === hasBuild) {
      return;
    }
    context.addIssue({
      code: "custom",
      message:
        "TEMPORAL_WORKER_DEPLOYMENT_NAME and TEMPORAL_WORKER_BUILD_ID must be configured together",
      path: hasDeployment
        ? ["TEMPORAL_WORKER_BUILD_ID"]
        : ["TEMPORAL_WORKER_DEPLOYMENT_NAME"],
    });
  });

export type TemporalBootstrap = {
  namespace: string;
  workerDeployment: { deploymentName: string; buildId: string } | undefined;
};

export function parseTemporalBootstrap(
  environment: Record<string, string | undefined>,
): TemporalBootstrap {
  const parsed = TemporalBootstrapEnvironmentSchema.parse(environment);
  const deploymentName = parsed.TEMPORAL_WORKER_DEPLOYMENT_NAME;
  const buildId =
    parsed.TEMPORAL_WORKER_BUILD_ID ??
    (deploymentName === undefined || parsed.GIT_SHA === "unknown"
      ? undefined
      : parsed.GIT_SHA);
  return {
    namespace: parsed.TEMPORAL_NAMESPACE ?? "default",
    workerDeployment:
      deploymentName === undefined || buildId === undefined
        ? undefined
        : { deploymentName, buildId },
  };
}

export function requireWorkerDeployment(bootstrap: TemporalBootstrap): {
  deploymentName: string;
  buildId: string;
} {
  if (bootstrap.workerDeployment === undefined) {
    throw new Error(
      "Workflow workers require TEMPORAL_WORKER_DEPLOYMENT_NAME and TEMPORAL_WORKER_BUILD_ID",
    );
  }
  return bootstrap.workerDeployment;
}
