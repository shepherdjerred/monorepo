import type {
  CommitBlocker,
  CommitEnvironment,
  CommitService,
  CommitEnvironmentGroup,
  CommitEnvironmentState,
  CommitVerdict,
  PipelineStatus,
} from "#shared/hub/hub-contract.ts";
import { attemptPhase } from "#shared/hub/deployment-phase.ts";

/** Where an automatic set revision sits in main's history: its build's pipeline, then registration. */
export type OrderKey = { major: number; minor: number };

/**
 * A set revision as far as liveness is concerned. `order` is null for a
 * manual hotfix, which no main pipeline composed.
 */
export type SetFacts = {
  revision: number;
  lineage: string;
  order: OrderKey | null;
};

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

/**
 * Whether a set revision includes a change: the same or a later revision of
 * its lineage, or, across a lineage change, an automatic set composed from
 * the same or a later main pipeline. A component-list change starts a new
 * lineage whose first set carries the accepted one forward, and automatic
 * composition never goes below the live set's order key, so a later key
 * holds the change's artifacts or newer builds of the same components.
 */
export function carries(change: SetFacts, set: SetFacts) {
  if (set.lineage === change.lineage) return set.revision >= change.revision;
  return (
    change.order !== null &&
    set.order !== null &&
    (set.order.major === change.order.major
      ? set.order.minor >= change.order.minor
      : set.order.major > change.order.major)
  );
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
 * A change is `deploying` only while such a deployment is running, and
 * `queued` while one waits to be claimed.
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
      return attemptPhase(status);
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
// An environment someone must act on (recover it, look at a failed
// deployment, approve one) outranks this commit's own CI failure, which only
// held back the services that failed.
const VERDICT_PRIORITY: CommitVerdict[] = [
  "recovery_required",
  "failed",
  "awaiting_approval",
  "build_failed",
  "building",
  "deploying",
  "queued",
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

/**
 * A commit's verdict. `changed` holds the verdict of every service it
 * changed, including, for each failed build a later passing commit carries,
 * that carrying build's release: the change ships there, so it counts as
 * this commit's until that release is live. A carried failure is therefore
 * not also a CI failure; only failures nothing carries are.
 */
export function commitVerdict(input: {
  changed: CommitVerdict[];
  failed: number;
  carried: number;
  pending: number;
  builds: number;
}): CommitVerdict {
  const parts = [...input.changed];
  if (input.failed > input.carried) parts.push("build_failed");
  if (input.pending > 0) parts.push("building");
  if (input.builds > 0 && parts.length === 0) parts.push("nothing_to_deploy");
  return rollUp(parts);
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
    case "queued": {
      return "queued";
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
  "queued",
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

type ChangedEnvironments = {
  service: { title: string };
  environments: CommitEnvironment[];
}[];

/**
 * Every environment of a changed service that does not have the change yet,
 * most urgent first, prod before others of the same urgency.
 */
export function blockingEnvironments(
  changed: ChangedEnvironments,
): CommitBlocker[] {
  const pending = changed.flatMap((entry) =>
    entry.environments
      .filter((environment) => !isLive(environment.state))
      .map((environment) => ({
        service: entry.service.title,
        environment: environment.name,
        state: environment.state,
      })),
  );
  return pending.toSorted(
    (left, right) =>
      stateRank(left.state) - stateRank(right.state) ||
      environmentOrder(left.environment, right.environment) ||
      left.service.localeCompare(right.service),
  );
}

/** The most urgent of `blockingEnvironments`; null when every one has the change. */
export function blockingEnvironment(changed: ChangedEnvironments) {
  return blockingEnvironments(changed)[0] ?? null;
}

/**
 * One entry per service. A pipeline can publish several builds of one
 * service for one commit, each composing the next set revision; the commit
 * changed the service once. In each environment the least advanced of its
 * builds' states speaks (the newest set is the last to arrive), and the
 * newest set names the release.
 */
export function mergeByService(changed: CommitService[]): CommitService[] {
  const byService = new Map<string, CommitService[]>();
  for (const entry of changed)
    byService.set(entry.service.id, [
      ...(byService.get(entry.service.id) ?? []),
      entry,
    ]);
  return [...byService.values()].map((entries) => {
    const [first, ...rest] = entries;
    if (first === undefined) throw new Error("A service group has an entry");
    if (rest.length === 0) return first;
    const newest = entries.reduce((left, right) =>
      (right.versionSet?.revision ?? 0) > (left.versionSet?.revision ?? 0)
        ? right
        : left,
    );
    const environments = new Map<string, CommitEnvironment>();
    for (const entry of entries)
      for (const environment of entry.environments) {
        const seen = environments.get(environment.environmentId);
        if (
          seen === undefined ||
          stateRank(environment.state) < stateRank(seen.state)
        )
          environments.set(environment.environmentId, environment);
      }
    const states = [...environments.values()];
    const includedIn = entries.find(
      (entry) => entry.includedIn !== undefined,
    )?.includedIn;
    return {
      ...newest,
      environments: states,
      verdict:
        states.length === 0
          ? rollUp(entries.map((entry) => entry.verdict))
          : serviceVerdict(
              "succeeded",
              states.map((entry) => entry.state),
            ),
      ...(includedIn === undefined ? {} : { includedIn }),
    };
  });
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
