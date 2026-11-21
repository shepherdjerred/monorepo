import type {
  CommitEnvironment,
  CommitEnvironmentGroup,
  CommitEnvironmentState,
  CommitVerdict,
  PipelineStatus,
} from "#shared/hub/hub-contract.ts";

/** A set revision as far as liveness is concerned. */
export type SetFacts = { revision: number; lineage: string };

/** The version set a build produced; null for a platform change. */
export type ChangeFacts = SetFacts | null;

export type EnvironmentFacts = {
  id: string;
  automatic: boolean;
  promotionSourceEnvironmentId: string | null;
  /** The selection the environment has accepted, if any. */
  accepted: SetFacts | null;
  /** Its newest deployment, of any change, failed and locked it for recovery. */
  locked: boolean;
};

/** A deployment as the commit rules read it. */
export type DeploymentFacts = {
  status: PipelineStatus;
  recoveryRequired: boolean;
  /**
   * Whether its success puts the change in the environment. A plan, a host
   * adoption or a repair proves something else and delivers nothing.
   */
  delivers: boolean;
};

/** Whether a set revision includes a change: the same or a later revision of its lineage. */
export function carries(change: SetFacts, set: SetFacts) {
  return set.lineage === change.lineage && set.revision >= change.revision;
}

const OPEN: ReadonlySet<PipelineStatus> = new Set([
  "queued",
  "pending",
  "running",
  "awaiting_approval",
]);

/**
 * Of the deployments that would deliver a change to one environment, the one
 * that says what is happening: the newest still queued, running or waiting
 * for a decision, else the newest that ended.
 */
export function decidingDeployment<
  T extends { createdAt: Date; status: PipelineStatus },
>(carriers: readonly T[]): T | null {
  const newestFirst = carriers.toSorted(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  );
  return (
    newestFirst.find((entry) => OPEN.has(entry.status)) ??
    newestFirst[0] ??
    null
  );
}

/**
 * Where one change stands in one environment. The accepted selection decides
 * liveness. Otherwise `deployment`, the deciding deployment among those that
 * would deliver the change (see `decidingDeployment`), says what is
 * happening; with none, the environment's own policy says why nothing is.
 * A change is `deploying` only while such a deployment is queued or running.
 * `sourceLive` is whether the environment it promotes from already has it.
 */
export function environmentState(input: {
  change: ChangeFacts;
  environment: EnvironmentFacts;
  deployment: DeploymentFacts | null;
  sourceLive: boolean;
}): CommitEnvironmentState {
  const { change, environment, deployment } = input;
  const accepted = environment.accepted;
  if (change !== null && accepted !== null && carries(change, accepted))
    return accepted.revision === change.revision ? "live" : "superseded";
  const succeeded = deployment?.status === "succeeded";
  // With no selection to compare, success is the proof: a platform change has
  // none, and an environment a platform operation applies to accepts none.
  if (
    succeeded &&
    deployment.delivers &&
    (change === null || accepted === null)
  )
    return "live";
  // Nothing deploys to a locked environment until an operator recovers it.
  if (environment.locked || deployment?.recoveryRequired === true)
    return "recovery_required";
  // A plan that succeeded delivered nothing, so the environment's policy speaks.
  const tried =
    deployment === null || (succeeded && !deployment.delivers)
      ? null
      : deploymentState(deployment.status);
  if (tried !== null) return tried;
  if (environment.promotionSourceEnvironmentId !== null && !input.sourceLive)
    return "waiting";
  return environment.automatic ? "not_started" : "manual";
}

/** What the deciding deployment's status says, or null when it never started. */
function deploymentState(
  status: PipelineStatus,
): CommitEnvironmentState | null {
  switch (status) {
    case "running":
    case "pending":
    case "queued": {
      return "deploying";
    }
    case "awaiting_approval": {
      return "awaiting_approval";
    }
    case "failed": {
      return "failed";
    }
    case "canceled": {
      return "canceled";
    }
    // It was accepted once, and the accepted selection no longer carries it.
    case "succeeded": {
      return "replaced";
    }
    case "not_started": {
      return null;
    }
  }
}

/** Whether a state means the change is running in that environment. */
export function isLive(state: CommitEnvironmentState) {
  return state === "live" || state === "superseded";
}

// Most urgent first: a failure outranks progress, progress outranks idling.
const VERDICT_PRIORITY: CommitVerdict[] = [
  "build_failed",
  "recovery_required",
  "failed",
  "awaiting_approval",
  "building",
  "deploying",
  "waiting",
  "deployed",
  "nothing_to_deploy",
  "unknown",
];

export function verdictRank(verdict: CommitVerdict) {
  return VERDICT_PRIORITY.indexOf(verdict);
}

/** The most urgent verdict among parts. */
export function rollUp(parts: CommitVerdict[]): CommitVerdict {
  return (
    VERDICT_PRIORITY.find((verdict) => parts.includes(verdict)) ?? "unknown"
  );
}

/** The verdict one environment's state contributes to its service and commit. */
export function stateVerdict(state: CommitEnvironmentState): CommitVerdict {
  switch (state) {
    case "live":
    case "superseded": {
      return "deployed";
    }
    case "deploying": {
      return "deploying";
    }
    case "awaiting_approval": {
      return "awaiting_approval";
    }
    case "recovery_required": {
      return "recovery_required";
    }
    case "failed": {
      return "failed";
    }
    case "canceled":
    case "replaced":
    case "manual":
    case "waiting":
    case "not_started": {
      return "waiting";
    }
  }
}

/** One service's verdict from its build and the state of each environment. */
export function serviceVerdict(
  buildStatus: PipelineStatus,
  states: CommitEnvironmentState[],
): CommitVerdict {
  if (buildStatus === "failed") return "build_failed";
  if (buildStatus === "pending") return "building";
  return states.length === 0
    ? "nothing_to_deploy"
    : rollUp(states.map((state) => stateVerdict(state)));
}

/**
 * Most urgent first, in the verdicts' order, so the first unfinished
 * environment is the one its commit's verdict came from. Among idle ones, a
 * cause (a manual release, a cancellation) precedes what waits on it.
 */
const STATE_URGENCY: CommitEnvironmentState[] = [
  "recovery_required",
  "failed",
  "awaiting_approval",
  "deploying",
  "manual",
  "canceled",
  "replaced",
  "not_started",
  "waiting",
  "live",
  "superseded",
];

export function stateRank(state: CommitEnvironmentState) {
  return STATE_URGENCY.indexOf(state);
}

/** The environment that matters most sorts first; the rest by name. */
function environmentOrder(left: string, right: string) {
  return left === "prod" || right === "prod"
    ? Number(right === "prod") - Number(left === "prod")
    : left.localeCompare(right);
}

/**
 * The most urgent environment of any changed service that does not have the
 * change yet, prod before others of the same urgency; null when every one
 * has it.
 */
export function blockingEnvironment(
  changed: {
    service: { title: string };
    environments: CommitEnvironment[];
  }[],
) {
  const pending = changed.flatMap((entry) =>
    entry.environments
      .filter((environment) => !isLive(environment.state))
      .map((environment) => ({
        service: entry.service.title,
        environment: environment.name,
        state: environment.state,
      })),
  );
  return (
    pending.toSorted(
      (left, right) =>
        stateRank(left.state) - stateRank(right.state) ||
        environmentOrder(left.environment, right.environment) ||
        left.service.localeCompare(right.service),
    )[0] ?? null
  );
}

/**
 * Regroup changed services by environment name. Environments of different
 * services that share a name ("prod") are one answer; a service with no
 * environment contributes nothing.
 */
export function groupByEnvironment(
  changed: {
    service: { id: string; title: string };
    environments: CommitEnvironment[];
  }[],
): CommitEnvironmentGroup[] {
  const groups = new Map<string, CommitEnvironmentGroup["members"]>();
  for (const entry of changed)
    for (const environment of entry.environments) {
      const members = groups.get(environment.name) ?? [];
      members.push({
        serviceId: entry.service.id,
        serviceTitle: entry.service.title,
        environmentId: environment.environmentId,
        state: environment.state,
        deploymentId: environment.deploymentId,
      });
      groups.set(environment.name, members);
    }
  return [...groups]
    .toSorted(([left], [right]) => environmentOrder(left, right))
    .map(([name, members]) => {
      const sorted = members.toSorted(
        (left, right) =>
          stateRank(left.state) - stateRank(right.state) ||
          left.serviceTitle.localeCompare(right.serviceTitle),
      );
      return {
        name,
        verdict: serviceVerdict(
          "succeeded",
          sorted.map((member) => member.state),
        ),
        liveCount: sorted.filter((member) => isLive(member.state)).length,
        total: sorted.length,
        members: sorted,
      };
    });
}
