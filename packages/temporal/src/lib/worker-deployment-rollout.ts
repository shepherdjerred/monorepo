import { z } from "zod";
import { WorkerBuildIdSchema } from "#shared/temporal-bootstrap.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { RETAINED_WORKFLOW_TASK_QUEUES } from "#worker-config";
import {
  prepareStablePinPromotion,
  prepareStablePinStatePromotion,
} from "./worker-deployment-catalog.ts";
import {
  DeploymentDescriptionSchema,
  DeploymentNameSchema,
  VersionDescriptionSchema,
} from "./worker-deployment-schemas.ts";
import {
  executeWorkerDeploymentRollback,
  removeWorkerDeploymentRampingVersion,
} from "./worker-deployment-rollback.ts";
import {
  queryRolloutMetric,
  requireHealthyWorkflowPoller,
  requireCleanCandidate,
  requireAcceptancePrerequisite,
  requireCleanAlertWindow,
  rolloutPoller,
  rolloutAdvanceTransition,
  runWorkerDeploymentPreflight,
  type RolloutCommandRunner,
  verifyCandidateImageBuildId,
} from "./worker-deployment-proofs.ts";
import { acquireWorkerDeploymentLock } from "./worker-deployment-lock.ts";
import {
  inspectWorkerDeploymentRollout,
  type WorkerDeploymentRolloutInspection,
} from "./worker-deployment-inspect.ts";
import {
  setCurrentVersion,
  setRampingVersion,
  temporalPrefix,
} from "./worker-deployment-commands.ts";
export type WorkerDeploymentRolloutOptions = {
  action: "inspect" | "status" | "start" | "advance" | "promote" | "rollback";
  address: string;
  namespace: string;
  tls?: boolean;
  deploymentName: string;
  rolloutLockName?: string;
  buildId: string;
  stableBuildId?: string;
  catalogPath: string;
  candidateStatePath: string;
  taskQueue: string;
  candidatePinName: string;
  stablePinName: string;
  imageRepository: string;
  replayCommands: readonly (readonly string[])[];
  canaryCommand: readonly string[];
  acceptancePrerequisite?: {
    deploymentName: string;
    taskQueue: string;
  };
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
function optionalNonEmpty(value: string): string | undefined {
  return value === "" ? undefined : value;
}
function requiredWorkflowQueues(
  options: WorkerDeploymentRolloutOptions,
): readonly string[] {
  return options.taskQueue === TASK_QUEUES.WORKFLOWS
    ? RETAINED_WORKFLOW_TASK_QUEUES
    : [options.taskQueue];
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
        requiredWorkflowQueues(options).map((taskQueue) =>
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
    const unhealthyQueue = requiredWorkflowQueues(options).find(
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
  if (deployment.name !== options.deploymentName) {
    throw new Error("Worker Deployment description does not match the target");
  }
  if (candidate === undefined) {
    throw new Error(`Candidate build ${options.buildId} is not registered`);
  }
  const newest = deployment.versionSummaries.toSorted((left, right) =>
    right.createTime.localeCompare(left.createTime),
  )[0];
  const currentBuildId = optionalNonEmpty(
    deployment.routingConfig.currentVersionBuildID,
  );
  const rampingBuildId = optionalNonEmpty(
    deployment.routingConfig.rampingVersionBuildID,
  );
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
  const missingQueues = requiredWorkflowQueues(options).filter(
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
    ...(options.rolloutLockName === undefined
      ? {}
      : {
          rolloutLockName: DeploymentNameSchema.parse(options.rolloutLockName),
        }),
    buildId: WorkerBuildIdSchema.parse(options.buildId),
    ...(options.stableBuildId === undefined
      ? {}
      : { stableBuildId: WorkerBuildIdSchema.parse(options.stableBuildId) }),
    namespace: z.string().min(1).parse(options.namespace),
    address: z.string().min(1).parse(options.address),
    taskQueue: z.string().min(1).parse(options.taskQueue),
    candidatePinName: z.string().min(1).parse(options.candidatePinName),
    stablePinName: z.string().min(1).parse(options.stablePinName),
    imageRepository: z.string().min(1).parse(options.imageRepository),
    replayCommands: z
      .array(z.array(z.string().min(1)).min(1))
      .parse(options.replayCommands),
    canaryCommand: z
      .array(z.string().min(1))
      .min(1)
      .parse(options.canaryCommand),
    ...(options.acceptancePrerequisite === undefined
      ? {}
      : {
          acceptancePrerequisite: z
            .object({
              deploymentName: DeploymentNameSchema,
              taskQueue: z.string().min(1),
            })
            .strict()
            .parse(options.acceptancePrerequisite),
        }),
  };
}
function elapsedMilliseconds(timestamp: string, now: Date): number {
  return now.getTime() - new Date(timestamp).getTime();
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
  const missingQueues = requiredWorkflowQueues(options).filter(
    (taskQueue) => !workflowQueues.has(taskQueue),
  );
  if (missingQueues.length > 0) {
    throw new Error(
      `Stable build ${buildId} is missing registered Workflow pollers for ${missingQueues.join(", ")}`,
    );
  }
  await Promise.all(
    requiredWorkflowQueues(options).map((taskQueue) =>
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
  await runWorkerDeploymentPreflight(options, run);
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
    await requireAcceptancePrerequisite(options, run);
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
      requiredWorkflowQueues(options).map((taskQueue) =>
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
  await requireAcceptancePrerequisite(options, run);
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
  await requireAcceptancePrerequisite(options, run);
  await setRampingVersion(options, transition.targetPercentage, run);
}
async function executePromotion(
  options: WorkerDeploymentRolloutOptions,
  status: WorkerDeploymentRolloutStatus,
  run: RolloutCommandRunner,
): Promise<void> {
  const promotedCatalog = await prepareStablePinPromotion(
    options.catalogPath,
    options.candidatePinName,
    options.stablePinName,
    options.imageRepository,
  );
  const promotedState = await prepareStablePinStatePromotion(
    options.candidateStatePath,
    options.candidatePinName,
    options.stablePinName,
  );
  if (
    status.currentBuildId === options.buildId &&
    status.rampingBuildId === undefined &&
    promotedCatalog.alreadyPromoted
  ) {
    if (promotedState.changed) {
      await Bun.write(options.candidateStatePath, promotedState.contents);
    }
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
  await requireAcceptancePrerequisite(options, run);
  await Bun.write(options.catalogPath, promotedCatalog.contents);
  if (promotedState.changed) {
    await Bun.write(options.candidateStatePath, promotedState.contents);
  }
  await setCurrentVersion(options, options.buildId, run);
  await removeWorkerDeploymentRampingVersion(options, run);
}
export async function executeWorkerDeploymentRollout(
  rawOptions: WorkerDeploymentRolloutOptions,
  run: RolloutCommandRunner,
): Promise<WorkerDeploymentRolloutStatus | WorkerDeploymentRolloutInspection> {
  const options = validateOptions(rawOptions);
  if (options.action === "inspect")
    return await inspectWorkerDeploymentRollout(options, run);
  if (options.action === "status") {
    const status = await readWorkerDeploymentRolloutStatus(options, run);
    requireCleanCandidate(status);
    return status;
  }
  const releaseLock = await acquireWorkerDeploymentLock(
    options.catalogPath,
    options.deploymentName,
    run,
  );
  try {
    const status = await readWorkerDeploymentRolloutStatus(
      options,
      run,
      options.action === "rollback",
      options.action !== "rollback",
    );
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
  } finally {
    await releaseLock();
  }
}
