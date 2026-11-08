import { z } from "zod";
import type {
  CompleteWorkerRecovery,
  DeploymentDetail,
  WorkerRolloutPlan,
} from "@shepherdjerred/delivery/contract";
import { stepRecipeOf } from "@shepherdjerred/delivery/model-contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import type { DeliverySelection } from "homelab/scripts/argocd/argocd-delivery.ts";
import { modelRecipe, modelSteps } from "#lib/delivery/model/recipe.ts";
import { renderApplication } from "#lib/delivery/model/application.ts";
import { modelWorkerChartSelection } from "#lib/delivery/model/worker-selection.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import { recordedWorkerPlan } from "./worker-plan.ts";
import { workerRolloutTarget } from "./worker-pool.ts";
import { workerSourceFingerprint } from "./worker-source.ts";

/** Fixed keys the model worker step's v1 Jobs record (E5); never prefixed. */
const WORKER_SUBSTAGES = new Set([
  "worker-prior-source",
  "worker-image-provenance",
  "worker-preflight",
  "worker-promote",
  "worker-verify",
]);

export type ModelWorkerRecovery = {
  application: string;
  /** The worker sub-recipe's sync was requested: hosts may run the candidate. */
  synced: boolean;
  /** Apply-safety may have written the body; no sync was requested. */
  written: boolean;
  /**
   * The sync was requested but never settled, and no step after it ran: no
   * routing change can have started (the worker-rollout step owns routing).
   */
  failedSync: boolean;
  /** The routing plan the worker preflight recorded, once it settled. */
  plan: WorkerRolloutPlan | undefined;
  /** The request identity every step of the deployment carries. */
  requestId: string;
  /** The frozen recipe's exact chart selection for the worker Application. */
  selection: () => DeliverySelection;
};

/**
 * Classifies a model worker deployment by its frozen recipe (T3, E5): the
 * recipe's step keys, compound `subN-` prefixes included, and the fixed
 * sub-stage keys of the worker Jobs. An unknown key, or an unsettled step of
 * another sub-recipe the worker recovery cannot inspect, fails closed. A v1
 * pipeline returns null and keeps its own classification.
 */
export function modelWorkerRecovery(
  detail: DeploymentDetail,
): ModelWorkerRecovery | null {
  const recipe = modelRecipe(detail);
  if (recipe === null) return null;
  const steps = modelSteps(recipe);
  const rollout = steps.find(
    (step) =>
      step.adapter === "kubernetes" && step.step.kind === "worker-rollout",
  );
  const target = workerRolloutTarget(detail);
  if (rollout === undefined || target === undefined)
    throw new Error(
      "Model worker recovery requires the frozen worker-rollout step",
    );
  const prefix = /^sub\d+-/u.exec(rollout.key)?.[0] ?? "";
  const keys = new Set(steps.map((step) => step.key));
  for (const stage of detail.stages) {
    if (WORKER_SUBSTAGES.has(stage.key)) continue;
    if (!keys.has(stage.key))
      throw new Error(
        `Recovery cannot classify stage ${stage.key} of the frozen recipe`,
      );
    if (!stage.key.startsWith(prefix) && stage.status !== "succeeded")
      throw new Error(
        `Step ${stage.key} of another sub-recipe is unsettled; worker recovery cannot inspect it`,
      );
  }
  const recorded = (key: string) =>
    detail.stages.some((stage) => stage.key === `${prefix}${key}`);
  const synced = recorded("step-sync");
  return {
    application: target.application,
    synced,
    written: !synced && recorded("step-apply-safety"),
    failedSync: stoppedInSync(detail, prefix),
    plan: detail.stages.some(
      (stage) =>
        stage.key === "worker-preflight" && stage.status === "succeeded",
    )
      ? recordedWorkerPlan(detail)
      : undefined,
    requestId: deliveryOperationId(detail.deployment.id),
    selection: () => modelWorkerChartSelection(detail).selection,
  };
}

/** Read-only work, or the body write, that may precede the worker sub-recipe's sync. */
const BEFORE_SYNC = new Set([
  "worker-prior-source",
  "worker-image-provenance",
  "step-apply-safety",
]);

/**
 * The worker sub-recipe recorded its sync without settling it, and nothing
 * after it: every other stage of its own is read-only work or the body write,
 * and succeeded. Other sub-recipes' steps were already required settled.
 */
function stoppedInSync(detail: DeploymentDetail, prefix: string): boolean {
  const own = (key: string) =>
    WORKER_SUBSTAGES.has(key)
      ? key
      : key.startsWith(prefix)
        ? key.slice(prefix.length)
        : null;
  const sync = detail.stages.find((stage) => own(stage.key) === "step-sync");
  return (
    sync !== undefined &&
    sync.status !== "succeeded" &&
    detail.stages.every((stage) => {
      const key = own(stage.key);
      return (
        key === null ||
        key === "step-sync" ||
        (BEFORE_SYNC.has(key) && stage.status === "succeeded")
      );
    })
  );
}

const FailedSyncSchema = z.object({
  operation: z.null().optional(),
  spec: z.object({ source: z.unknown() }),
  status: z.object({
    sync: z.object({ status: z.enum(["Synced", "OutOfSync"]) }),
    operationState: z.object({
      phase: z.enum(["Failed", "Error"]),
      operation: z.object({
        info: z.array(z.object({ name: z.string(), value: z.string() })),
      }),
    }),
  }),
});

/**
 * This deployment's own sync ended terminally without succeeding: nothing is
 * in flight, the operation carries exactly this deployment's request, and the
 * Application holds exactly the body it rendered. Returns the Argo operation
 * receipt and the observed sync status.
 */
export function requireFailedOwnedSync(
  observed: unknown,
  detail: DeploymentDetail,
  model: ModelWorkerRecovery,
): { receipt: string; sync: "Synced" | "OutOfSync" } {
  const application = FailedSyncSchema.parse(observed);
  const info = application.status.operationState.operation.info;
  const requests = info.filter(
    (entry) => entry.name === "ci.sjer.red/request-id",
  );
  if (requests.length !== 1 || requests[0]?.value !== model.requestId)
    throw new Error(
      "The failed worker sync is not owned by this frozen deployment",
    );
  const recipe = stepRecipeOf(detail.pipeline.definition, "worker-rollout");
  if (
    recipe === null ||
    canonicalJson(application.spec.source) !==
      canonicalJson(renderApplication(detail, recipe).body.spec.source)
  )
    throw new Error(
      "The worker Application no longer holds the body this deployment synced",
    );
  const receipts = info.filter(
    (entry) => entry.name === "ci.sjer.red/operation-id",
  );
  if (receipts.length !== 1)
    throw new Error("Argo operation receipt has no unique operation identity");
  return {
    receipt: z.uuid().parse(receipts[0]?.value),
    sync: application.status.sync.status,
  };
}

const ApplicationSchema = z.object({
  spec: z.object({ source: z.unknown() }),
  status: z.object({
    operationState: z
      .object({
        operation: z.object({
          info: z
            .array(z.object({ name: z.string(), value: z.string() }))
            .default([]),
        }),
      })
      .optional(),
  }),
});

/**
 * Apply-safety writes the worker body with automation off. Until a sync is
 * requested the hosts stay on the prior source: the Application carries
 * either that prior source or exactly the rendered candidate body, and its
 * last operation was never this deployment's request.
 */
export function requireUnsyncedModelSource(
  before: unknown,
  detail: DeploymentDetail,
  model: ModelWorkerRecovery,
): "prior" | "written" {
  const application = ApplicationSchema.parse(before);
  if (
    application.status.operationState?.operation.info.some(
      (entry) =>
        entry.name === "ci.sjer.red/request-id" &&
        entry.value === model.requestId,
    ) === true
  )
    throw new Error(
      "This deployment's sync request reached the worker Application without a recorded sync step",
    );
  const prior = detail.stages.find(
    (stage) =>
      stage.key === "worker-prior-source" && stage.status === "succeeded",
  );
  if (prior?.operationId === workerSourceFingerprint(before)) return "prior";
  const recipe = stepRecipeOf(detail.pipeline.definition, "worker-rollout");
  if (
    recipe === null ||
    !model.written ||
    canonicalJson(application.spec.source) !==
      canonicalJson(renderApplication(detail, recipe).body.spec.source)
  )
    throw new Error(
      "Recovery prior source or ownership changed, or was never captured",
    );
  return "written";
}

/**
 * A model rollout routes by the plan its preflight recorded: each planned
 * route reads either its recorded prior build or the candidate, and every
 * other served route stays on a retained host.
 */
export function requirePlannedRecoveryRoutes(
  plan: WorkerRolloutPlan,
  routes: CompleteWorkerRecovery["routes"],
) {
  const planned = new Map(
    (plan.routes.length > 0
      ? plan.routes
      : [
          {
            namespace: plan.namespace,
            expectedCurrentBuildId: plan.expectedCurrentBuildId,
          },
        ]
    ).map((route) => [route.namespace, route.expectedCurrentBuildId]),
  );
  for (const route of routes) {
    const expected = planned.get(route.namespace);
    if (
      expected !== undefined &&
      ![expected, plan.candidateBuildId].includes(route.currentBuildId)
    )
      throw new Error(
        `Routing in ${route.namespace} left the recorded plan: neither its prior build nor the candidate`,
      );
  }
}
