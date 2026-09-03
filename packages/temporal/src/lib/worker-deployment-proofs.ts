import { z } from "zod";
import { WorkerBuildIdSchema } from "#shared/temporal-bootstrap.ts";
import { WORKFLOW_TASK_QUEUES } from "#worker-config";

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
const ImageEnvironmentSchema = z.array(z.string());
const REQUIRED_PROMETHEUS_HISTORY_SAMPLES = {
  "30m": 60,
  "2h": 240,
  "24h": 2880,
} as const;
const MAX_RULE_EVALUATION_AGE_SECONDS = 300;
const AcceptedDeploymentSchema = z.object({
  name: z.string().min(1),
  routingConfig: z.object({
    currentVersionBuildID: z.string(),
    rampingVersionBuildID: z.string(),
    rampingVersionPercentage: z.number().min(0).max(100),
  }),
});

export type RolloutCommandResult = { stdout: string; stderr: string };
export type RolloutCommandRunner = (
  command: readonly string[],
) => Promise<RolloutCommandResult>;

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

export function requireCleanCandidate(status: {
  workflowPollers: number | undefined;
  activeTemporalAlerts: number | undefined;
}): void {
  if (status.workflowPollers !== undefined && status.workflowPollers < 1) {
    throw new Error("Candidate has no healthy Workflow pollers");
  }
  if (
    status.activeTemporalAlerts !== undefined &&
    status.activeTemporalAlerts !== 0
  ) {
    throw new Error(
      `Refusing rollout with ${String(status.activeTemporalAlerts)} active Temporal alerts`,
    );
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

export function rolloutPoller(
  options: {
    namespace: string;
    deploymentName: string;
    buildId: string;
    taskQueue: string;
  },
  currentBuildId?: string,
): {
  namespace: string;
  deploymentName: string;
  buildId: string;
  currentBuildId?: string;
  taskQueue: string;
  taskQueues?: readonly string[];
} {
  return {
    ...options,
    ...(currentBuildId === undefined ? {} : { currentBuildId }),
    taskQueue: options.taskQueue,
    ...(options.taskQueue === WORKFLOW_TASK_QUEUES[0]
      ? {
          taskQueues: WORKFLOW_TASK_QUEUES,
        }
      : {}),
  };
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
  const result = await run([
    "toolkit",
    "temporal",
    "worker",
    "deployment",
    "describe",
    "--name",
    options.deploymentName,
    "--output",
    "json",
  ]);
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
      deploymentName: string;
      taskQueue: string;
    };
  },
  run: RolloutCommandRunner,
): Promise<void> {
  if (options.acceptancePrerequisite === undefined) return;
  await requireAcceptedWorkerDeployment(
    {
      address: options.address,
      namespace: options.namespace,
      ...(options.tls === undefined ? {} : { tls: options.tls }),
      buildId: options.buildId,
      ...options.acceptancePrerequisite,
    },
    run,
  );
}

async function requireHealthyRuleEvaluations(
  duration: "30m" | "2h" | "24h",
  run: RolloutCommandRunner,
): Promise<void> {
  const evaluationProgress = await queryRolloutMetric(
    `min(min_over_time((changes(prometheus_rule_group_last_evaluation_timestamp_seconds{rule_group=~".*;temporal-.*"}[5m]) > bool 0)[${duration}:5m]))`,
    `${duration} Temporal rule evaluation progression query`,
    run,
  );
  if (evaluationProgress <= 0) {
    throw new Error(
      `Temporal rule evaluations did not advance during the required ${duration} clean window`,
    );
  }
  const historicalEvaluationAgeSeconds = await queryRolloutMetric(
    `max(max_over_time((time() - prometheus_rule_group_last_evaluation_timestamp_seconds{rule_group=~".*;temporal-.*"})[${duration}:1m]))`,
    `${duration} Temporal rule evaluation historical age query`,
    run,
  );
  if (historicalEvaluationAgeSeconds > MAX_RULE_EVALUATION_AGE_SECONDS) {
    throw new Error(
      `Temporal rule evaluations reached ${String(historicalEvaluationAgeSeconds)} seconds old during the required ${duration} clean window`,
    );
  }
  const evaluationAgeSeconds = await queryRolloutMetric(
    `max(time() - max by (rule_group) (prometheus_rule_group_last_evaluation_timestamp_seconds{rule_group=~".*;temporal-.*"}))`,
    `${duration} Temporal rule evaluation freshness query`,
    run,
  );
  if (evaluationAgeSeconds > MAX_RULE_EVALUATION_AGE_SECONDS) {
    throw new Error(
      `Temporal rule evaluations are ${String(evaluationAgeSeconds)} seconds old`,
    );
  }
  const evaluationFailures = await queryRolloutMetric(
    `sum(increase(prometheus_rule_evaluation_failures_total{rule_group=~".*;temporal-.*"}[${duration}])) or vector(0)`,
    `${duration} Temporal rule evaluation failure query`,
    run,
  );
  if (evaluationFailures !== 0) {
    throw new Error(
      `Temporal Prometheus rules recorded ${String(evaluationFailures)} evaluation failures during the required ${duration} clean window`,
    );
  }
}

async function requirePollerHistory(input: {
  duration: "30m" | "2h" | "24h";
  requiredHistorySamples: number;
  buildId: string;
  taskQueue: string;
  poller: {
    namespace: string;
    deploymentName: string;
  };
  run: RolloutCommandRunner;
}): Promise<void> {
  const { duration, requiredHistorySamples, buildId, taskQueue, poller, run } =
    input;
  const pollerSelector = `sum(temporal_worker_num_pollers{temporal_namespace=${JSON.stringify(poller.namespace)},worker_deployment_name=${JSON.stringify(poller.deploymentName)},worker_build_id=${JSON.stringify(buildId)},task_queue=${JSON.stringify(taskQueue)},poller_type="workflow_task"})`;
  const pollerHistorySamples = await queryRolloutMetric(
    `count_over_time((${pollerSelector})[${duration}:])`,
    `${duration} ${buildId} ${taskQueue} Workflow poller coverage query`,
    run,
  );
  if (pollerHistorySamples < requiredHistorySamples) {
    throw new Error(
      `Workflow poller history for ${buildId} on ${taskQueue} covered only ${String(pollerHistorySamples)} samples during the required ${duration} clean window`,
    );
  }
  const pollerSamples = await queryRolloutMetric(
    `min_over_time((${pollerSelector})[${duration}:])`,
    `${duration} ${buildId} ${taskQueue} Workflow poller history query`,
    run,
  );
  if (pollerSamples < 1) {
    throw new Error(
      `Workflow poller for ${buildId} on ${taskQueue} was unavailable during the required ${duration} clean window`,
    );
  }
}

export async function requireCleanAlertWindow(
  duration: "30m" | "2h" | "24h",
  run: RolloutCommandRunner,
  poller?: {
    namespace: string;
    deploymentName: string;
    buildId: string;
    currentBuildId?: string;
    taskQueue: string;
    taskQueues?: readonly string[];
  },
): Promise<void> {
  const requiredHistorySamples = REQUIRED_PROMETHEUS_HISTORY_SAMPLES[duration];
  const historySamples = await queryRolloutMetric(
    `min(min by (rule_group) (count_over_time(prometheus_rule_group_last_evaluation_timestamp_seconds{rule_group=~".*;temporal-.*"}[${duration}])))`,
    `${duration} Temporal rule evaluation history query`,
    run,
  );
  if (historySamples < requiredHistorySamples) {
    throw new Error(
      `Temporal Prometheus history covered only ${String(historySamples)} samples during the required ${duration} clean window`,
    );
  }
  await requireHealthyRuleEvaluations(duration, run);
  const alertSamples = await queryRolloutMetric(
    `sum(max_over_time(ALERTS{alertstate="firing",alertname=~"Temporal.*"}[${duration}])) or vector(0)`,
    `${duration} Temporal alert history query`,
    run,
  );
  if (alertSamples !== 0) {
    throw new Error(
      `Temporal alerts fired during the required ${duration} clean window`,
    );
  }
  if (poller !== undefined) {
    const buildIds = [poller.buildId];
    if (
      poller.currentBuildId !== undefined &&
      poller.currentBuildId !== poller.buildId
    ) {
      buildIds.push(poller.currentBuildId);
    }
    for (const buildId of buildIds) {
      for (const taskQueue of poller.taskQueues ?? [poller.taskQueue]) {
        await requirePollerHistory({
          duration,
          requiredHistorySamples,
          buildId,
          taskQueue,
          poller,
          run,
        });
      }
    }
  }
}

export function rolloutAdvanceTransition(rampPercentage: number): {
  minimumMilliseconds: number;
  targetPercentage: number;
} {
  if (rampPercentage === 10) {
    return { minimumMilliseconds: 30 * 60 * 1000, targetPercentage: 50 };
  }
  if (rampPercentage === 50) {
    return {
      minimumMilliseconds: 2 * 60 * 60 * 1000,
      targetPercentage: 100,
    };
  }
  throw new Error("Advance requires a 10% or 50% ramp");
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
    "{{json .Image.Config.Env}}",
  ]);
  const environment = ImageEnvironmentSchema.parse(
    parseJson(result.stdout, "candidate image inspection"),
  );
  if (!environment.includes(`GIT_SHA=${buildId}`)) {
    throw new Error(`Candidate image ${image} was not built from ${buildId}`);
  }
}
