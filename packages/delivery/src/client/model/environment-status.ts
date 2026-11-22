import type { Deployment, VersionSetRevision } from "#shared/contract.ts";
import { isTerminal } from "#client/presentation.ts";
import { relativeTime } from "#client/components/time.tsx";
import { revisionLabel } from "#client/components/identifier.tsx";

/**
 * What stops this environment from taking a new request, as the server's
 * admission refuses one (`requireIdleEnvironment`): the deployment that owns
 * it, or one still queued or awaiting approval.
 *
 * - `locked`: the owning deployment ended recovery-required, so the
 *   environment stays locked until its external work has been inspected.
 * - `in-flight`: a deployment is queued, running or awaiting approval;
 *   `behind` more wait after it.
 * - `held`: a deployment owns the environment but is not among the recent
 *   deployments the page loaded, so only its id is known.
 */
export type Blocker =
  | { kind: "locked"; deployment: Deployment }
  | { kind: "in-flight"; deployment: Deployment; behind: number }
  | { kind: "held"; deploymentId: string };

export function environmentBlocker(detail: {
  environment: { activeDeploymentId: string | null };
  deployments: readonly Deployment[];
}): Blocker | null {
  const active = detail.environment.activeDeploymentId;
  const owner =
    active === null
      ? undefined
      : detail.deployments.find((deployment) => deployment.id === active);
  if (owner !== undefined && isTerminal(owner))
    return owner.recoveryRequired
      ? { kind: "locked", deployment: owner }
      : { kind: "held", deploymentId: owner.id };
  const unfinished = detail.deployments.filter(
    (deployment) => !isTerminal(deployment),
  );
  const lead = owner ?? unfinished[0];
  if (lead !== undefined)
    return {
      kind: "in-flight",
      deployment: lead,
      behind: unfinished.filter((deployment) => deployment.id !== lead.id)
        .length,
    };
  return active === null ? null : { kind: "held", deploymentId: active };
}

/**
 * The environment's newest deployment when it failed and is not the one
 * that accepted the release it runs: the release it was last asked for and
 * does not run. Null when the newest deployment did not fail.
 */
export function newestFailure(detail: {
  environment: { acceptedDeploymentId: string | null };
  /** Newest first, as the environment page loads them. */
  deployments: readonly Deployment[];
}) {
  const [newest] = detail.deployments;
  return newest?.status === "failed" &&
    newest.id !== detail.environment.acceptedDeploymentId
    ? newest
    : null;
}

/** The id of the deployment a blocker names. */
export function blockingDeploymentId(blocker: Blocker) {
  return blocker.kind === "held" ? blocker.deploymentId : blocker.deployment.id;
}

/**
 * An unfinished deployment's state in words. A running deployment whose
 * saved OpenTofu plan waits for a human reads as awaiting plan approval,
 * not as running.
 */
export function inFlightWords(
  status: Deployment["status"],
  planWaiting: boolean,
) {
  return status === "running" && planWaiting
    ? "awaiting plan approval"
    : status.replaceAll("_", " ");
}

/** The status a pill shows for an unfinished deployment, as `inFlightWords` reads it. */
export function inFlightStatus(
  status: Deployment["status"],
  planWaiting: boolean,
) {
  return status === "running" && planWaiting ? "awaiting_approval" : status;
}

/**
 * A version set as an operator picks it: its revision, the commit it was
 * built from, and how long ago it was composed. A set whose components come
 * from different commits reads as composed.
 */
export function versionOptionLabel(version: VersionSetRevision, now: number) {
  const sources = new Set(
    Object.values(version.components).map(
      (component) => component.sourceRevision,
    ),
  );
  const [source] = sources;
  const origin =
    source !== undefined && sources.size === 1
      ? source.slice(0, 7)
      : "composed";
  return `${revisionLabel(version.revision)} · ${origin} · ${relativeTime(version.createdAt, now)}`;
}

/** At most two decimals, and none for a whole number: `55.42`, not `55.42128888888888`. */
const EVIDENCE_NUMBER = new Intl.NumberFormat("en", {
  maximumFractionDigits: 2,
});

export function formatEvidence(value: number) {
  return EVIDENCE_NUMBER.format(value);
}
