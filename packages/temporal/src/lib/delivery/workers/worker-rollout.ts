import {
  WorkerRolloutPlanSchema,
  workerHostSpecification,
} from "@shepherdjerred/delivery/contract";
import type {
  WorkerRolloutSnapshot,
  EvidenceInput,
  WorkerRolloutAction,
  WorkerRolloutPlan,
} from "@shepherdjerred/delivery/contract";
import { WORKFLOW_TASK_QUEUES } from "#shared/task-queues.ts";
import {
  DeploymentDescriptionSchema,
  VersionDescriptionSchema,
} from "#lib/worker-deployment-schemas.ts";
import { resolveWorkerDeploymentRolloutTarget } from "#lib/worker-deployment-target.ts";
import {
  parseTemporalJson,
  setCurrentVersion,
  temporalCommand,
} from "#lib/worker-deployment-commands.ts";
import {
  requireAcceptancePrerequisite,
  requireHealthyWorkflowPoller,
  runWorkerDeploymentPreflight,
  verifyCandidateImageBuildId,
} from "#lib/worker-deployment-proofs.ts";
import type { RolloutCommandRunner } from "#lib/worker-deployment-proofs.ts";

export type DeliveryWorkerConnection = { address: string; tls?: boolean };
export type DeliveryWorkerReceipt = {
  action: WorkerRolloutAction;
  candidateBuildId: string;
  currentBuildId: string;
  rampingBuildId: string;
  rampPercentage: number;
  evidence: EvidenceInput[];
};
type Options = ReturnType<typeof rolloutOptions>;

function rolloutOptions(
  detail: WorkerRolloutSnapshot,
  connection: DeliveryWorkerConnection,
) {
  const pipeline = detail.pipeline.definition;
  if (pipeline.kind !== "argocd" || pipeline.workerRollout === undefined)
    throw new Error("Deployment does not declare a worker rollout");
  const policy = pipeline.workerRollout;
  const pool = detail.deployment.workerSnapshot;
  if (pool?.target !== policy.target || pool.workerOperation !== "rollout")
    throw new Error("Worker routing requires its immutable retained-host pool");
  const artifact = detail.versionSet.components[policy.imageComponent];
  if (artifact?.kind !== "image")
    throw new Error(
      "Worker rollout requires its exact published image artifact",
    );
  const target = resolveWorkerDeploymentRolloutTarget(
    policy.target,
    connection.address,
  );
  if (artifact.uri !== target.imageRepository)
    throw new Error(
      "Worker rollout artifact belongs to a different image repository",
    );
  if (
    pool.candidateBuildId !== artifact.sourceRevision ||
    !pool.versions.some(
      (worker) =>
        worker.buildId === artifact.sourceRevision &&
        worker.artifactId === artifact.id &&
        worker.replicas === 1,
    )
  )
    throw new Error("Worker candidate is absent from the retained-host pool");
  const application = policy.target === "central" ? "temporal" : policy.target;
  if (pipeline.application !== application)
    throw new Error("Worker rollout target differs from its Argo application");
  return {
    ...connection,
    ...target,
    target: policy.target,
    namespace: policy.target === "scout-beta" ? "beta" : "prod",
    buildId: artifact.sourceRevision,
    candidateImage: `${artifact.uri}@${artifact.digest}`,
    deploymentId: detail.deployment.id,
  };
}

async function routing(options: Options, run: RolloutCommandRunner) {
  const response = await run(
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
  const deployment = DeploymentDescriptionSchema.parse(
    parseTemporalJson(response.stdout, "worker deployment routing"),
  );
  if (deployment.name !== options.deploymentName)
    throw new Error("Worker deployment routing belongs to another target");
  return deployment.routingConfig;
}

async function requireCandidate(options: Options, run: RolloutCommandRunner) {
  const response = await run(
    temporalCommand(options, [
      "worker",
      "deployment",
      "describe-version",
      "--deployment-name",
      options.deploymentName,
      "--build-id",
      options.buildId,
      "--report-task-queue-stats",
      "--output",
      "json",
    ]),
  );
  const version = VersionDescriptionSchema.parse(
    parseTemporalJson(response.stdout, "worker candidate version"),
  );
  const queues =
    options.target === "central" ? WORKFLOW_TASK_QUEUES : [options.taskQueue];
  if (version.BuildID !== options.buildId)
    throw new Error("Worker version belongs to another candidate");
  for (const taskQueue of queues) {
    if (
      !version.taskQueuesInfos.some(
        (entry) => entry.type === "workflow" && entry.name === taskQueue,
      )
    )
      throw new Error(
        `Candidate is missing required workflow queue ${taskQueue}`,
      );
    await requireHealthyWorkflowPoller(
      {
        namespace: options.namespace,
        deploymentName: options.deploymentName,
        buildId: options.buildId,
        taskQueue,
      },
      run,
      "candidate",
    );
  }
}

/** Runner must execute replay and canary commands from this candidate's clean checkout. */
async function prepareRoute(
  detail: WorkerRolloutSnapshot,
  connection: DeliveryWorkerConnection,
  run: RolloutCommandRunner,
  namespace: "prod" | "beta",
): Promise<WorkerRolloutPlan> {
  const options = { ...rolloutOptions(detail, connection), namespace };
  await verifyCandidateImageBuildId(
    options.candidateImage,
    options.buildId,
    run,
  );
  await requireCandidate(options, run);
  await runWorkerDeploymentPreflight(options, run);
  await requireAcceptancePrerequisite(options, run);
  const state = await routing(options, run);
  if (
    state.currentVersionBuildID === "" ||
    state.currentVersionBuildID === options.buildId
  )
    throw new Error(
      "A rollout requires a distinct, explicitly established stable current worker",
    );
  if (
    state.rampingVersionBuildID !== "" ||
    state.rampingVersionPercentage !== 0
  )
    throw new Error("Worker deployment already has an active ramp");
  await requireHealthyWorkflowPoller(
    {
      namespace: options.namespace,
      deploymentName: options.deploymentName,
      buildId: state.currentVersionBuildID,
      taskQueue: options.taskQueue,
    },
    run,
    "stable",
  );
  return WorkerRolloutPlanSchema.parse({
    target: options.target,
    namespace: options.namespace,
    deploymentName: options.deploymentName,
    taskQueue: options.taskQueue,
    candidateBuildId: options.buildId,
    candidateImage: options.candidateImage,
    expectedCurrentBuildId: state.currentVersionBuildID,
    deploymentId: detail.deployment.id,
  });
}

export async function prepareDeliveryWorkerRollout(
  detail: WorkerRolloutSnapshot,
  connection: DeliveryWorkerConnection,
  run: RolloutCommandRunner,
): Promise<WorkerRolloutPlan> {
  const options = rolloutOptions(detail, connection);
  const plans = [];
  for (const route of workerHostSpecification(options.target).routes)
    plans.push(await prepareRoute(detail, connection, run, route.namespace));
  const primary = plans[0];
  if (primary === undefined)
    throw new Error("Worker rollout has no served namespaces");
  return {
    ...primary,
    routes: plans.map((plan) => ({
      namespace: plan.namespace,
      expectedCurrentBuildId: plan.expectedCurrentBuildId,
    })),
  };
}

function requirePlan(
  detail: WorkerRolloutSnapshot,
  plan: WorkerRolloutPlan,
  options: Options,
) {
  if (
    plan.deploymentId !== detail.deployment.id ||
    plan.candidateImage !== options.candidateImage ||
    plan.candidateBuildId !== options.buildId ||
    plan.target !== options.target ||
    plan.namespace !== options.namespace ||
    plan.deploymentName !== options.deploymentName ||
    plan.taskQueue !== options.taskQueue
  )
    throw new Error("Worker rollout plan differs from the frozen deployment");
}
function unchangedStable(
  state: Awaited<ReturnType<typeof routing>>,
  plan: WorkerRolloutPlan,
) {
  if (state.currentVersionBuildID !== plan.expectedCurrentBuildId)
    throw new Error("Current worker changed outside this deployment");
}
function requireNoRamp(state: Awaited<ReturnType<typeof routing>>) {
  if (
    state.rampingVersionBuildID !== "" ||
    state.rampingVersionPercentage !== 0
  )
    throw new Error("Worker deployment has an active ramp");
}

async function canary(
  options: Options,
  run: RolloutCommandRunner,
  routingMode: "pinned" | "normal",
) {
  await run([
    ...options.canaryCommand,
    "--namespace",
    options.namespace,
    ...(routingMode === "pinned"
      ? [
          "--deployment-name",
          options.deploymentName,
          "--build-id",
          options.buildId,
        ]
      : options.target === "central"
        ? [
            "--deployment-name",
            options.deploymentName,
            "--build-id",
            options.buildId,
            "--routing",
            "normal",
          ]
        : []),
  ]);
}

async function promote(
  options: Options,
  plan: WorkerRolloutPlan,
  run: RolloutCommandRunner,
) {
  const before = await routing(options, run);
  requireNoRamp(before);
  // Inspect an ambiguous prior response before repeating the same mutation.
  if (before.currentVersionBuildID === options.buildId) return;
  unchangedStable(before, plan);
  await requireAcceptancePrerequisite(options, run);
  await verifyCandidateImageBuildId(
    options.candidateImage,
    options.buildId,
    run,
  );
  await canary(options, run, "pinned");
  const checked = await routing(options, run);
  unchangedStable(checked, plan);
  requireNoRamp(checked);
  await setCurrentVersion(options, options.buildId, run);
}

async function stepRoute(
  input: {
    detail: WorkerRolloutSnapshot;
    plan: WorkerRolloutPlan;
    action: WorkerRolloutAction;
    connection: DeliveryWorkerConnection;
  },
  run: RolloutCommandRunner,
  namespace: "prod" | "beta",
): Promise<DeliveryWorkerReceipt> {
  const options = {
    ...rolloutOptions(input.detail, input.connection),
    namespace,
  };
  const plan = WorkerRolloutPlanSchema.parse(input.plan);
  requirePlan(input.detail, plan, options);
  await requireCandidate(options, run);
  switch (input.action) {
    case "promote":
      await promote(options, plan, run);
      break;
    case "verify":
      break;
  }
  const state = await routing(options, run);
  if (
    state.currentVersionBuildID !== options.buildId ||
    state.rampingVersionBuildID !== "" ||
    state.rampingVersionPercentage !== 0
  )
    throw new Error("Candidate is not the exclusively accepted current worker");
  if (input.action === "verify") {
    await canary(options, run, "normal");
    const after = await routing(options, run);
    requireNoRamp(after);
    if (after.currentVersionBuildID !== options.buildId)
      throw new Error(
        "Current worker changed during the normally routed canary",
      );
  }
  return {
    action: input.action,
    candidateBuildId: options.buildId,
    currentBuildId: state.currentVersionBuildID,
    rampingBuildId: state.rampingVersionBuildID,
    rampPercentage: state.rampingVersionPercentage,
    evidence: [
      {
        kind: "runtime",
        summary: `Worker ${options.deploymentName} candidate ${options.buildId}: ${input.action}; current ${state.currentVersionBuildID}; ramp ${String(state.rampingVersionPercentage)}%`,
      },
    ],
  };
}

export async function stepDeliveryWorkerRollout(
  input: Parameters<typeof stepRoute>[0],
  run: RolloutCommandRunner,
): Promise<DeliveryWorkerReceipt> {
  const plan = WorkerRolloutPlanSchema.parse(input.plan);
  const expected = workerHostSpecification(plan.target).routes.map(
    (route) => route.namespace,
  );
  if (
    JSON.stringify(plan.routes.map((route) => route.namespace)) !==
      JSON.stringify(expected) ||
    plan.routes[0]?.expectedCurrentBuildId !== plan.expectedCurrentBuildId
  )
    throw new Error(
      "Worker rollout plan does not cover every served namespace",
    );
  const results = [];
  for (const route of plan.routes)
    results.push(
      await stepRoute(
        {
          ...input,
          plan: {
            ...plan,
            namespace: route.namespace,
            expectedCurrentBuildId: route.expectedCurrentBuildId,
          },
        },
        run,
        route.namespace,
      ),
    );
  const primary = results[0];
  if (primary === undefined) throw new Error("Worker rollout has no receipts");
  return {
    ...primary,
    evidence: results.flatMap((receipt) => receipt.evidence),
  };
}
