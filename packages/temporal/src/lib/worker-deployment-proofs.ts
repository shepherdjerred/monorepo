import { z } from "zod";
import { WorkerBuildIdSchema } from "#shared/temporal-bootstrap.ts";

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
} {
  return {
    ...options,
    ...(currentBuildId === undefined ? {} : { currentBuildId }),
    taskQueue: options.taskQueue,
  };
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

export async function requireCleanAlertWindow(
  duration: "30m" | "2h" | "24h",
  run: RolloutCommandRunner,
  poller?: {
    namespace: string;
    deploymentName: string;
    buildId: string;
    currentBuildId?: string;
    taskQueue: string;
  },
): Promise<void> {
  const requiredHistorySamples = REQUIRED_PROMETHEUS_HISTORY_SAMPLES[duration];
  const historySamples = await queryRolloutMetric(
    `sum(count_over_time(prometheus_rule_group_last_evaluation_timestamp_seconds{rule_group=~".*;temporal-.*"}[${duration}]))`,
    `${duration} Temporal rule evaluation history query`,
    run,
  );
  if (historySamples < requiredHistorySamples) {
    throw new Error(
      `Temporal Prometheus history covered only ${String(historySamples)} samples during the required ${duration} clean window`,
    );
  }
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
      const pollerSelector = `sum(temporal_worker_num_pollers{temporal_namespace=${JSON.stringify(poller.namespace)},worker_deployment_name=${JSON.stringify(poller.deploymentName)},worker_build_id=${JSON.stringify(buildId)},task_queue=${JSON.stringify(poller.taskQueue)},poller_type="workflow_task"})`;
      const pollerHistorySamples = await queryRolloutMetric(
        `count_over_time((${pollerSelector})[${duration}:])`,
        `${duration} ${buildId} Workflow poller coverage query`,
        run,
      );
      if (pollerHistorySamples < requiredHistorySamples) {
        throw new Error(
          `Workflow poller history for ${buildId} covered only ${String(pollerHistorySamples)} samples during the required ${duration} clean window`,
        );
      }
      const pollerSamples = await queryRolloutMetric(
        `min_over_time((${pollerSelector})[${duration}:])`,
        `${duration} ${buildId} Workflow poller history query`,
        run,
      );
      if (pollerSamples < 1) {
        throw new Error(
          `Workflow poller for ${buildId} was unavailable during the required ${duration} clean window`,
        );
      }
    }
  }
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
