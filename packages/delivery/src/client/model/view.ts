import {
  PLAN_APPROVAL_STAGE_KEY,
  stepStageKey,
  type ApprovalQueueItem,
  type DeploymentDetailV2,
  type EnvironmentSelection,
  type MonitorStatus,
  type Selection,
} from "#shared/model/contract.ts";
import { RETRYABLE_DEPLOYMENT_KINDS } from "#shared/deployment-request-contract.ts";

const RETRYABLE_KINDS: ReadonlySet<string> = new Set(
  RETRYABLE_DEPLOYMENT_KINDS,
);

/** Whether the hub offers a retry: a failed or canceled deployment of a kind the API retries. */
export function retryable(deployment: { kind: string; status: string }) {
  return (
    RETRYABLE_KINDS.has(deployment.kind) &&
    (deployment.status === "failed" || deployment.status === "canceled")
  );
}

/**
 * The saved plan a model `tofu` recipe's approve step is waiting on (section
 * 5), or null when the recipe has no approve step, the step is not running,
 * or the plan is already approved.
 */
export function waitingPlan(detail: DeploymentDetailV2) {
  const recipe = detail.pipeline.definition;
  if (
    recipe.kind !== "tofu" ||
    !("steps" in recipe) ||
    !recipe.steps.some((step) => step.kind === "approve")
  )
    return null;
  const stage = (key: string) =>
    detail.stages.find((entry) => entry.key === key);
  if (stage(PLAN_APPROVAL_STAGE_KEY)?.status === "succeeded") return null;
  return stage(stepStageKey("step", "approve"))?.status === "running"
    ? detail.savedPlan
    : null;
}

/** The three coordinates of a selection (4.9), in reading order. */
export function selectionCoordinates(selection: Selection) {
  return [
    { label: "Set revision", value: selection.versionSetRevisionId },
    { label: "Recipe revision", value: selection.recipeRevisionId },
    {
      label: "Configuration revision",
      value: selection.configurationRevisionId,
    },
  ] as const;
}

export type EvidenceRow = {
  key: string;
  threshold: number;
  value: number | null;
  met: boolean;
};

/** Each declared evidence count against its threshold in the latest observation (W4). */
export function monitorEvidence(status: MonitorStatus): EvidenceRow[] {
  if (status.monitor === null) return [];
  const observed = status.latestObservation?.evidence ?? {};
  return status.monitor.evidence.map((entry) => {
    const value = observed[entry.key] ?? null;
    return {
      key: entry.key,
      threshold: entry.threshold,
      value,
      met: value !== null && value >= entry.threshold,
    };
  });
}

/** Firing alarms of the latest observation that the monitor counts (W2). */
export function firingAlarms(status: MonitorStatus) {
  if (status.monitor === null || status.latestObservation === null) return [];
  const severities = new Set<string>(status.monitor.alarms.severities);
  return status.latestObservation.alarms.filter((alarm) =>
    severities.has(alarm.severity),
  );
}

export function monitorPolicyLabel(policy: MonitorStatus["policy"]) {
  switch (policy) {
    case "automatic": {
      return "Roll back automatically on alarm";
    }
    case "hold": {
      return "Hold for an operator on alarm";
    }
    case null: {
      return "No monitor declared";
    }
  }
}

/**
 * The recipe and configuration revisions a rebind to the declared binding
 * would change (L2), or null when nothing differs or nothing is accepted.
 */
export function rebindChanges(view: EnvironmentSelection) {
  if (view.accepted === null) return null;
  const changes = {
    ...(view.declared.recipeRevisionId === view.accepted.recipeRevisionId
      ? {}
      : { recipeRevisionId: view.declared.recipeRevisionId }),
    ...(view.declared.configurationRevisionId ===
    view.accepted.configurationRevisionId
      ? {}
      : { configurationRevisionId: view.declared.configurationRevisionId }),
  };
  return Object.keys(changes).length === 0 ? null : changes;
}

/** An approval queue item still waits for a human decision. */
export function awaitsDecision(item: ApprovalQueueItem) {
  return item.approval === null
    ? item.status === "awaiting_approval"
    : item.approval.status === "pending";
}
