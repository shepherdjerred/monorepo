import type {
  CommitEnvironment,
  CommitEnvironmentGroup,
  CommitEnvironmentState,
  CommitVerdict,
  PipelineStatus,
} from "#shared/hub/hub-contract.ts";

/** The version set a build produced, as far as liveness is concerned. */
export type ChangeFacts = { revision: number; lineage: string } | null;

export type EnvironmentFacts = {
  id: string;
  automatic: boolean;
  promotionSourceEnvironmentId: string | null;
  /** The selection the environment has accepted, if any. */
  accepted: { revision: number; lineage: string } | null;
};

/**
 * Where one change stands in one environment. The accepted selection decides
 * liveness: the same or a later revision of the same lineage carries the
 * change. Otherwise the newest deployment aimed at it says what is happening.
 * `sourceLive` is whether the environment it promotes from already has it.
 */
export function environmentState(input: {
  change: ChangeFacts;
  environment: EnvironmentFacts;
  deployment: { status: PipelineStatus; recoveryRequired: boolean } | null;
  sourceLive: boolean;
}): CommitEnvironmentState {
  const { change, environment, deployment } = input;
  const accepted = environment.accepted;
  if (
    change !== null &&
    accepted !== null &&
    accepted.lineage === change.lineage &&
    accepted.revision >= change.revision
  )
    return accepted.revision === change.revision ? "live" : "superseded";
  if (deployment !== null) {
    if (deployment.recoveryRequired) return "failed";
    switch (deployment.status) {
      case "succeeded": {
        // A platform change has no selection to compare; success is the proof.
        return change === null ? "live" : "waiting";
      }
      case "failed": {
        return "failed";
      }
      case "running":
      case "pending":
      case "queued": {
        return "deploying";
      }
      case "awaiting_approval": {
        return "awaiting_approval";
      }
      case "canceled": {
        return "canceled";
      }
      case "not_started": {
        return "waiting";
      }
    }
  }
  const promoted = environment.promotionSourceEnvironmentId !== null;
  if (promoted && !input.sourceLive) return "waiting";
  return environment.automatic ? "waiting" : "manual";
}

/** Whether a state means the change is running in that environment. */
export function isLive(state: CommitEnvironmentState) {
  return state === "live" || state === "superseded";
}

// Most urgent first: a failure outranks progress, progress outranks idling.
const VERDICT_PRIORITY: CommitVerdict[] = [
  "build_failed",
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

/** One service's verdict from its build and the state of each environment. */
export function serviceVerdict(
  buildStatus: PipelineStatus,
  states: CommitEnvironmentState[],
): CommitVerdict {
  if (buildStatus === "failed") return "build_failed";
  if (buildStatus === "pending") return "building";
  if (states.length === 0) return "nothing_to_deploy";
  return rollUp(
    states.map((state): CommitVerdict => {
      switch (state) {
        case "live":
        case "superseded": {
          return "deployed";
        }
        case "deploying":
        case "waiting": {
          return "deploying";
        }
        case "awaiting_approval": {
          return "awaiting_approval";
        }
        case "failed": {
          return "failed";
        }
        case "canceled":
        case "manual": {
          return "waiting";
        }
      }
    }),
  );
}

const STATE_URGENCY: CommitEnvironmentState[] = [
  "failed",
  "awaiting_approval",
  "deploying",
  "waiting",
  "manual",
  "canceled",
  "live",
  "superseded",
];

/** The environment that matters most sorts first; the rest by name. */
function environmentOrder(left: string, right: string) {
  return left === "prod" || right === "prod"
    ? Number(right === "prod") - Number(left === "prod")
    : left.localeCompare(right);
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
          STATE_URGENCY.indexOf(left.state) -
            STATE_URGENCY.indexOf(right.state) ||
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
