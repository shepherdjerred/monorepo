import { z } from "zod";
import { ociImageConfigurations } from "@shepherdjerred/ops-model/oci-image-configurations.ts";
import { WorkerBuildIdSchema } from "#shared/infra/temporal-bootstrap.ts";
import { temporalCommand } from "./worker-deployment-commands.ts";

export type RolloutCommandResult = { stdout: string; stderr: string };
export type RolloutCommandRunner = (
  command: readonly string[],
) => Promise<RolloutCommandResult>;

const PrometheusResponseSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    resultType: z.literal("vector"),
    result: z.array(
      z.object({
        value: z.tuple([z.number(), z.string()]),
      }),
    ),
  }),
});
const AcceptedDeploymentSchema = z.object({
  name: z.string().min(1),
  routingConfig: z.object({
    currentVersionBuildID: z.string(),
    rampingVersionBuildID: z.string(),
    rampingVersionPercentage: z.number().min(0).max(100),
  }),
});

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON`, { cause: error });
  }
}

function singlePrometheusValue(raw: string, label: string): number {
  const response = PrometheusResponseSchema.parse(parseJson(raw, label));
  const sample = response.data.result[0];
  if (sample === undefined || response.data.result.length !== 1) {
    throw new Error(`${label} must return exactly one sample`);
  }
  const value = Number(sample.value[1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} returned an invalid value`);
  }
  return value;
}

export async function queryRolloutMetric(
  expression: string,
  label: string,
  run: RolloutCommandRunner,
): Promise<number> {
  const result = await run([
    "toolkit",
    "prom",
    "query",
    expression,
    "--output",
    "json",
  ]);
  return singlePrometheusValue(result.stdout, label);
}

export async function requireHealthyWorkflowPoller(
  options: {
    namespace: string;
    deploymentName: string;
    buildId: string;
    taskQueue: string;
  },
  run: RolloutCommandRunner,
  label: string,
): Promise<void> {
  const pollers = await queryRolloutMetric(
    `sum(temporal_worker_num_pollers{temporal_namespace=${JSON.stringify(options.namespace)},worker_deployment_name=${JSON.stringify(options.deploymentName)},worker_build_id=${JSON.stringify(options.buildId)},task_queue=${JSON.stringify(options.taskQueue)},poller_type="workflow_task"}) or vector(0)`,
    `${label} workflow poller query`,
    run,
  );
  if (pollers < 1) {
    throw new Error(`${label} build has no healthy Workflow pollers`);
  }
}

export async function requireReplayCheckout(
  buildId: string,
  run: RolloutCommandRunner,
): Promise<void> {
  const checkout = await run(["git", "rev-parse", "HEAD"]);
  const checkoutBuildId = WorkerBuildIdSchema.parse(checkout.stdout.trim());
  if (checkoutBuildId !== buildId) {
    throw new Error(
      `Replay checkout ${checkoutBuildId} does not match candidate build ${buildId}`,
    );
  }
  const status = await run([
    "git",
    "status",
    "--porcelain=v1",
    "--untracked-files=no",
  ]);
  if (status.stdout.trim().length > 0) {
    throw new Error("Replay checkout has tracked modifications");
  }
}

export async function runWorkerDeploymentPreflight(
  options: {
    buildId: string;
    deploymentName: string;
    namespace: string;
    replayCommands: readonly (readonly string[])[];
    canaryCommand: readonly string[];
  },
  run: RolloutCommandRunner,
): Promise<void> {
  await requireReplayCheckout(options.buildId, run);
  for (const command of options.replayCommands) await run(command);
  await run([
    ...options.canaryCommand,
    "--deployment-name",
    options.deploymentName,
    "--build-id",
    options.buildId,
    "--namespace",
    options.namespace,
  ]);
}

export async function requireAcceptedWorkerDeployment(
  options: {
    address: string;
    namespace: string;
    tls?: boolean;
    buildId: string;
    deploymentName: string;
    taskQueue: string;
  },
  run: RolloutCommandRunner,
): Promise<void> {
  const result = await run(
    temporalCommand(options, [
      "worker",
      "deployment",
      "describe",
      "--name",
      options.deploymentName,
      "--output",
      "json",
    ]),
  );
  const deployment = AcceptedDeploymentSchema.parse(
    parseJson(result.stdout, "acceptance prerequisite deployment describe"),
  );
  if (
    deployment.name !== options.deploymentName ||
    deployment.routingConfig.currentVersionBuildID !== options.buildId ||
    deployment.routingConfig.rampingVersionBuildID !== "" ||
    deployment.routingConfig.rampingVersionPercentage !== 0
  ) {
    throw new Error(
      `Build ${options.buildId} has not completed ${options.deploymentName} acceptance`,
    );
  }
  const pollers = await queryRolloutMetric(
    `sum(temporal_worker_num_pollers{temporal_namespace=${JSON.stringify(options.namespace)},worker_deployment_name=${JSON.stringify(options.deploymentName)},worker_build_id=${JSON.stringify(options.buildId)},task_queue=${JSON.stringify(options.taskQueue)},poller_type="workflow_task"}) or vector(0)`,
    "acceptance prerequisite workflow poller query",
    run,
  );
  if (pollers < 1) {
    throw new Error(
      `${options.deploymentName} acceptance has no healthy Workflow pollers`,
    );
  }
}
export async function requireAcceptancePrerequisite(
  options: {
    address: string;
    namespace: string;
    tls?: boolean;
    buildId: string;
    acceptancePrerequisite?: {
      namespace: string;
      deploymentName: string;
      taskQueue: string;
    };
  },
  run: RolloutCommandRunner,
): Promise<void> {
  if (options.acceptancePrerequisite === undefined) return;
  // The prerequisite deployment lives in its own stage namespace (Scout beta
  // acceptance gates the prod rollout), not the namespace being rolled out.
  await requireAcceptedWorkerDeployment(
    {
      address: options.address,
      ...(options.tls === undefined ? {} : { tls: options.tls }),
      buildId: options.buildId,
      ...options.acceptancePrerequisite,
    },
    run,
  );
}

export async function verifyCandidateImageBuildId(
  image: string,
  buildId: string,
  run: RolloutCommandRunner,
): Promise<void> {
  const result = await run([
    "docker",
    "buildx",
    "imagetools",
    "inspect",
    image,
    "--format",
    "{{json .Image}}",
  ]);
  const configurations = ociImageConfigurations(
    parseJson(result.stdout, "candidate image inspection"),
  );
  if (
    configurations.some(
      (configuration) =>
        !configuration.config.Env.includes(`GIT_SHA=${buildId}`),
    )
  ) {
    throw new Error(`Candidate image ${image} was not built from ${buildId}`);
  }
}
