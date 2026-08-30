import { z } from "zod";
import { WorkerBuildIdSchema } from "#shared/temporal-bootstrap.ts";
import { RETAINED_WORKFLOW_TASK_QUEUES } from "#worker-config";
import { prepareStablePinPromotion } from "./worker-deployment-catalog.ts";
import {
  executeWorkerDeploymentRollback,
  removeWorkerDeploymentRampingVersion,
} from "./worker-deployment-rollback.ts";
import {
  queryRolloutMetric,
  requireHealthyWorkflowPoller,
  requireCleanAlertWindow,
  rolloutPoller,
  rolloutAdvanceTransition,
  runWorkerDeploymentPreflightProofs,
  type RolloutCommandRunner,
  verifyCandidateImageBuildId,
} from "./worker-deployment-proofs.ts";
const DeploymentNameSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,125}[a-z0-9])?$/);
const TimestampSchema = z.iso.datetime({ offset: true });
const RoutingSchema = z.object({
  currentVersionBuildID: z.string(),
  rampingVersionBuildID: z.string(),
  rampingVersionPercentage: z.number().min(0).max(100),
  currentVersionChangedTime: TimestampSchema,
  rampingVersionChangedTime: TimestampSchema,
  rampingVersionPercentageChangedTime: TimestampSchema,
});
const DeploymentDescriptionSchema = z.object({
  name: DeploymentNameSchema,
  routingConfig: RoutingSchema,
  versionSummaries: z.array(
    z.object({
      BuildID: WorkerBuildIdSchema,
      createTime: TimestampSchema,
    }),
  ),
});
const VersionDescriptionSchema = z.object({
  BuildID: WorkerBuildIdSchema,
  taskQueuesInfos: z.array(
    z.object({
      name: z.string().min(1),
      type: z.enum(["workflow", "activity", "nexus"]),
    }),
  ),
});
export type WorkerDeploymentRolloutOptions = {
  action: "status" | "start" | "advance" | "promote" | "rollback";
  address: string;
  namespace: string;
  tls?: boolean;
  deploymentName: string;
  buildId: string;
  taskQueue: string;
  stableBuildId?: string;
  catalogPath: string;
  candidateStatePath: string;
  now?: Date;
};
export type WorkerDeploymentRolloutStatus = {
  deploymentName: string;
  candidateBuildId: string;
  currentBuildId: string | undefined;
  rampingBuildId: string | undefined;
  rampPercentage: number;
  candidateWorkflowQueues: string[];
  workflowPollers: number | undefined;
  activeTemporalAlerts: number | undefined;
  lastRampChange: string;
};
function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON`, { cause: error });
  }
}
function temporalPrefix(options: WorkerDeploymentRolloutOptions): string[] {
  return [
    "toolkit",
    "temporal",
    "--address",
    options.address,
    "--namespace",
    options.namespace,
    ...(options.tls === true ? ["--tls"] : []),
  ];
}
async function describeDeployment(
  options: WorkerDeploymentRolloutOptions,
  run: RolloutCommandRunner,
): Promise<z.infer<typeof DeploymentDescriptionSchema>> {
  const result = await run([
    ...temporalPrefix(options),
    "worker",
    "deployment",
    "describe",
    "--name",
    options.deploymentName,
    "--output",
    "json",
  ]);
  return DeploymentDescriptionSchema.parse(
    parseJson(result.stdout, "worker deployment describe"),
  );
}
async function describeVersion(
  options: WorkerDeploymentRolloutOptions,
  buildId: string,
  run: RolloutCommandRunner,
): Promise<z.infer<typeof VersionDescriptionSchema>> {
  const result = await run([
    ...temporalPrefix(options),
    "worker",
    "deployment",
    "describe-version",
    "--deployment-name",
    options.deploymentName,
    "--build-id",
    buildId,
    "--report-task-queue-stats",
    "--output",
    "json",
  ]);
  return VersionDescriptionSchema.parse(
    parseJson(result.stdout, "worker deployment describe-version"),
  );
}
export async function readWorkerDeploymentRolloutStatus(
  rawOptions: WorkerDeploymentRolloutOptions,
  run: RolloutCommandRunner,
  allowStaleCandidate = false,
  includeMetrics = true,
): Promise<WorkerDeploymentRolloutStatus> {
  const options = validateOptions(rawOptions);
  const [deployment, version] = await Promise.all([
    describeDeployment(options, run),
    describeVersion(options, options.buildId, run),
  ]);
  let workflowPollers: number | undefined;
  let activeTemporalAlerts: number | undefined;
  if (includeMetrics) {
    const [workflowPollerCounts, temporalAlerts] = await Promise.all([
      Promise.all(
        RETAINED_WORKFLOW_TASK_QUEUES.map((taskQueue) =>
          queryRolloutMetric(
            `sum(temporal_worker_num_pollers{temporal_namespace=${JSON.stringify(options.namespace)},worker_deployment_name=${JSON.stringify(options.deploymentName)},worker_build_id=${JSON.stringify(options.buildId)},task_queue=${JSON.stringify(taskQueue)},poller_type="workflow_task"}) or vector(0)`,
            `${taskQueue} workflow poller query`,
            run,
          ),
        ),
      ),
      queryRolloutMetric(
        'count(ALERTS{alertstate="firing",alertname=~"Temporal.*"}) or vector(0)',
        "Temporal alert query",
        run,
      ),
    ]);
    workflowPollers = workflowPollerCounts[0];
    activeTemporalAlerts = temporalAlerts;
    const unhealthyQueue = RETAINED_WORKFLOW_TASK_QUEUES.find(
      (_, index) => (workflowPollerCounts[index] ?? 0) < 1,
    );
    if (unhealthyQueue !== undefined) {
      throw new Error(
        `Candidate build ${options.buildId} has no healthy Workflow pollers on ${unhealthyQueue}`,
      );
    }
  }
  const candidate = deployment.versionSummaries.find(
    (versionSummary) => versionSummary.BuildID === options.buildId,
  );
  if (candidate === undefined) {
    throw new Error(`Candidate build ${options.buildId} is not registered`);
  }
  const newest = deployment.versionSummaries.toSorted((left, right) =>
    right.createTime.localeCompare(left.createTime),
  )[0];
  const currentBuildId =
    deployment.routingConfig.currentVersionBuildID === ""
      ? undefined
      : deployment.routingConfig.currentVersionBuildID;
  const rampingBuildId =
    deployment.routingConfig.rampingVersionBuildID === ""
      ? undefined
      : deployment.routingConfig.rampingVersionBuildID;
  if (
    !allowStaleCandidate &&
    options.action !== "rollback" &&
    newest?.BuildID !== options.buildId
  ) {
    throw new Error(
      `Candidate build ${options.buildId} is stale; newest registered build is ${String(newest?.BuildID)}`,
    );
  }
  if (version.BuildID !== options.buildId) {
    throw new Error("Version description does not match the candidate build");
  }
  const workflowQueues = version.taskQueuesInfos
    .filter((queue) => queue.type === "workflow")
    .map((queue) => queue.name)
    .toSorted();
  const missingQueues = RETAINED_WORKFLOW_TASK_QUEUES.filter(
    (taskQueue) => !workflowQueues.includes(taskQueue),
  );
  if (missingQueues.length > 0) {
    throw new Error(
      `Candidate build ${options.buildId} is missing registered Workflow pollers for ${missingQueues.join(", ")}`,
    );
  }
  return {
    deploymentName: deployment.name,
    candidateBuildId: options.buildId,
    currentBuildId,
    rampingBuildId,
    rampPercentage: deployment.routingConfig.rampingVersionPercentage,
    candidateWorkflowQueues: workflowQueues,
    workflowPollers,
    activeTemporalAlerts,
    lastRampChange:
      deployment.routingConfig.rampingVersionPercentageChangedTime,
  };
}
function validateOptions(
  options: WorkerDeploymentRolloutOptions,
): WorkerDeploymentRolloutOptions {
  return {
    ...options,
    deploymentName: DeploymentNameSchema.parse(options.deploymentName),
    buildId: WorkerBuildIdSchema.parse(options.buildId),
    ...(options.stableBuildId === undefined
      ? {}
      : { stableBuildId: WorkerBuildIdSchema.parse(options.stableBuildId) }),
    namespace: z.string().min(1).parse(options.namespace),
    address: z.string().min(1).parse(options.address),
    taskQueue: z.string().min(1).parse(options.taskQueue),
  };
}
function requireCleanCandidate(status: WorkerDeploymentRolloutStatus): void {
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
function elapsedMilliseconds(timestamp: string, now: Date): number {
  return now.getTime() - new Date(timestamp).getTime();
}
async function setRampingVersion(
  options: WorkerDeploymentRolloutOptions,
  percentage: number,
  run: RolloutCommandRunner,
): Promise<void> {
  await run([
    ...temporalPrefix(options),
    "worker",
    "deployment",
    "set-ramping-version",
    "--deployment-name",
    options.deploymentName,
    "--build-id",
    options.buildId,
    "--percentage",
    String(percentage),
    "--yes",
    "--output",
    "json",
  ]);
}
async function setCurrentVersion(
  options: WorkerDeploymentRolloutOptions,
  buildId: string,
  run: RolloutCommandRunner,
): Promise<void> {
  await run([
    ...temporalPrefix(options),
    "worker",
    "deployment",
    "set-current-version",
    "--deployment-name",
    options.deploymentName,
    "--build-id",
    buildId,
    "--yes",
    "--output",
    "json",
  ]);
}
async function requireRegisteredWorkflowVersion(
  options: WorkerDeploymentRolloutOptions,
  buildId: string,
  run: RolloutCommandRunner,
): Promise<void> {
  const version = await describeVersion(options, buildId, run);
  const workflowQueues = new Set(
    version.taskQueuesInfos
      .filter((queue) => queue.type === "workflow")
      .map((queue) => queue.name),
  );
  const requiredQueues = RETAINED_WORKFLOW_TASK_QUEUES;
  const missingQueues = requiredQueues.filter(
    (taskQueue) => !workflowQueues.has(taskQueue),
  );
  if (missingQueues.length > 0) {
    throw new Error(
      `Stable build ${buildId} is missing registered Workflow pollers for ${missingQueues.join(", ")}`,
    );
  }
  await Promise.all(
    requiredQueues.map((taskQueue) =>
      requireHealthyWorkflowPoller(
        {
          namespace: options.namespace,
          deploymentName: options.deploymentName,
          buildId,
          taskQueue,
        },
        run,
        `stable ${taskQueue}`,
      ),
    ),
  );
}
async function executeStart(
  options: WorkerDeploymentRolloutOptions,
  status: WorkerDeploymentRolloutStatus,
  run: RolloutCommandRunner,
): Promise<void> {
  if (status.rampingBuildId !== undefined || status.rampPercentage !== 0) {
    throw new Error("Start requires no active ramp");
  }
  if (status.currentBuildId === options.buildId) {
    throw new Error("Candidate is already the current version");
  }
  await runWorkerDeploymentPreflightProofs(options, run);
  if (status.currentBuildId === undefined) {
    if (
      options.stableBuildId === undefined ||
      options.stableBuildId === options.buildId
    ) {
      throw new Error(
        "Empty deployments require a distinct --stable-build-id before candidate ramping",
      );
    }
    await requireRegisteredWorkflowVersion(options, options.stableBuildId, run);
    await setCurrentVersion(options, options.stableBuildId, run);
  }
  const latestStatus = await readWorkerDeploymentRolloutStatus(options, run);
  const expectedCurrentBuildId = status.currentBuildId ?? options.stableBuildId;
  if (
    latestStatus.currentBuildId !== expectedCurrentBuildId ||
    latestStatus.rampingBuildId !== undefined ||
    latestStatus.rampPercentage !== 0
  ) {
    throw new Error("Deployment routing changed during start preflight");
  }
  requireCleanCandidate(latestStatus);
  if (latestStatus.currentBuildId !== undefined) {
    const currentBuildId = latestStatus.currentBuildId;
    await Promise.all(
      RETAINED_WORKFLOW_TASK_QUEUES.map((taskQueue) =>
        requireHealthyWorkflowPoller(
          {
            namespace: options.namespace,
            deploymentName: options.deploymentName,
            buildId: currentBuildId,
            taskQueue,
          },
          run,
          `current ${taskQueue}`,
        ),
      ),
    );
  }
  await setRampingVersion(options, 10, run);
}
function requireCandidateRamp(
  options: WorkerDeploymentRolloutOptions,
  status: WorkerDeploymentRolloutStatus,
): void {
  if (status.rampingBuildId !== options.buildId) {
    throw new Error(
      "Transition requires the candidate to be the ramping version",
    );
  }
}
async function executeAdvance(
  options: WorkerDeploymentRolloutOptions,
  status: WorkerDeploymentRolloutStatus,
  run: RolloutCommandRunner,
): Promise<void> {
  requireCandidateRamp(options, status);
  const transition = rolloutAdvanceTransition(status.rampPercentage);
  const now = options.now ?? new Date();
  if (
    elapsedMilliseconds(status.lastRampChange, now) <
    transition.minimumMilliseconds
  ) {
    throw new Error("Candidate has not completed the required clean window");
  }
  await requireCleanAlertWindow(
    status.rampPercentage === 10 ? "30m" : "2h",
    run,
    rolloutPoller(options, status.currentBuildId),
  );
  const latestStatus = await readWorkerDeploymentRolloutStatus(options, run);
  if (
    latestStatus.rampingBuildId !== options.buildId ||
    latestStatus.rampPercentage !== status.rampPercentage
  ) {
    throw new Error("Deployment ramp changed during advance preflight");
  }
  requireCleanCandidate(latestStatus);
  await setRampingVersion(options, transition.targetPercentage, run);
}
async function executePromotion(
  options: WorkerDeploymentRolloutOptions,
  status: WorkerDeploymentRolloutStatus,
  run: RolloutCommandRunner,
): Promise<void> {
  const promotedCatalog = await prepareStablePinPromotion(options.catalogPath);
  if (
    status.currentBuildId === options.buildId &&
    status.rampingBuildId === undefined &&
    promotedCatalog.alreadyPromoted
  ) {
    return;
  }
  requireCandidateRamp(options, status);
  if (status.rampPercentage !== 100) {
    throw new Error("Promote requires a 100% ramp");
  }
  const now = options.now ?? new Date();
  if (elapsedMilliseconds(status.lastRampChange, now) < 24 * 60 * 60 * 1000) {
    throw new Error("Candidate has not completed the 24-hour clean soak");
  }
  await requireCleanAlertWindow(
    "24h",
    run,
    rolloutPoller(options, status.currentBuildId),
  );
  await verifyCandidateImageBuildId(
    promotedCatalog.candidateImage,
    options.buildId,
    run,
  );
  const latestStatus = await readWorkerDeploymentRolloutStatus(options, run);
  if (
    latestStatus.rampingBuildId !== options.buildId ||
    latestStatus.rampPercentage !== 100
  ) {
    throw new Error(
      "Promotion requires the candidate to still be ramping at 100%",
    );
  }
  requireCleanCandidate(latestStatus);
  await Bun.write(options.catalogPath, promotedCatalog.contents);
  await setCurrentVersion(options, options.buildId, run);
  await removeWorkerDeploymentRampingVersion(options, run);
}
export async function executeWorkerDeploymentRollout(
  rawOptions: WorkerDeploymentRolloutOptions,
  run: RolloutCommandRunner,
): Promise<WorkerDeploymentRolloutStatus> {
  const options = validateOptions(rawOptions);
  const status = await readWorkerDeploymentRolloutStatus(
    options,
    run,
    options.action === "rollback",
    options.action !== "rollback",
  );
  if (options.action === "status") {
    requireCleanCandidate(status);
    return status;
  }
  if (options.action === "rollback") {
    await executeWorkerDeploymentRollback(options, status, run);
    return await readWorkerDeploymentRolloutStatus(options, run, true, false);
  }
  requireCleanCandidate(status);
  if (options.action === "start") {
    await executeStart(options, status, run);
    return await readWorkerDeploymentRolloutStatus(options, run);
  }
  if (options.action === "advance") {
    await executeAdvance(options, status, run);
    return await readWorkerDeploymentRolloutStatus(options, run);
  }
  await executePromotion(options, status, run);
  return await readWorkerDeploymentRolloutStatus(options, run);
}
