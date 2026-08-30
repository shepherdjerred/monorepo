import { z } from "zod";

const WorkerBuildIdSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "must be an exact lowercase Git SHA");

const WorkflowWorkerEnvironmentSchema = z
  .object({
    ENVIRONMENT: z.enum(["beta", "prod"]),
    GIT_SHA: WorkerBuildIdSchema,
    TEMPORAL_ADDRESS: z.string().min(1),
    TEMPORAL_METRICS_ADDRESS: z.string().min(1).default("0.0.0.0:9464"),
    TEMPORAL_NAMESPACE: z.string().min(1).default("default"),
    TEMPORAL_WORKER_BUILD_ID: WorkerBuildIdSchema.optional(),
    TEMPORAL_WORKER_DEPLOYMENT_NAME: z.string().min(1),
  })
  .superRefine((environment, context) => {
    if (
      environment.TEMPORAL_WORKER_BUILD_ID !== undefined &&
      environment.TEMPORAL_WORKER_BUILD_ID !== environment.GIT_SHA
    ) {
      context.addIssue({
        code: "custom",
        path: ["TEMPORAL_WORKER_BUILD_ID"],
        message: "must match the baked GIT_SHA",
      });
    }
  });

export type ScoutWorkflowWorkerConfiguration = {
  stage: "beta" | "prod";
  address: string;
  metricsAddress: string;
  namespace: string;
  deploymentName: string;
  buildId: string;
};

export function parseScoutWorkflowWorkerConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): ScoutWorkflowWorkerConfiguration {
  const parsed = WorkflowWorkerEnvironmentSchema.parse(environment);
  const expectedDeploymentName = `scout-${parsed.ENVIRONMENT}-workflows`;
  if (parsed.TEMPORAL_WORKER_DEPLOYMENT_NAME !== expectedDeploymentName) {
    throw new Error(
      `Scout ${parsed.ENVIRONMENT} Workflow Worker must use deployment ${expectedDeploymentName}`,
    );
  }
  return {
    stage: parsed.ENVIRONMENT,
    address: parsed.TEMPORAL_ADDRESS,
    metricsAddress: parsed.TEMPORAL_METRICS_ADDRESS,
    namespace: parsed.TEMPORAL_NAMESPACE,
    deploymentName: parsed.TEMPORAL_WORKER_DEPLOYMENT_NAME,
    buildId: parsed.GIT_SHA,
  };
}
