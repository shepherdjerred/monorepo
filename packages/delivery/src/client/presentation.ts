import type { Deployment, Environment, Principal } from "#shared/contract.ts";
import type { ImageCheck } from "#shared/hub/integration-contract.ts";
import { relativeTime } from "#client/components/time.tsx";

export function canApprove(principal: Principal): boolean {
  return principal.kind === "human" && principal.scopes.includes("approve");
}

export function canDeploy(principal: Principal): boolean {
  return principal.scopes.includes("deploy");
}

export function isTerminal(deployment: Deployment): boolean {
  return ["succeeded", "failed", "canceled"].includes(deployment.status);
}

/**
 * The executor's message takes the tone of the outcome it reports: a failure,
 * an acceptance, or progress. A canceled release keeps the attention tone.
 */
export function messageNotice(status: Deployment["status"]) {
  switch (status) {
    case "failed": {
      return "notice error";
    }
    case "succeeded": {
      return "notice success";
    }
    case "canceled": {
      return "notice";
    }
    case "queued":
    case "awaiting_approval":
    case "running": {
      return "notice info";
    }
  }
}

/**
 * The revision number of every set revision the environment page has loaded:
 * the service's newest version sets and the set revisions of the
 * environment's recent deployments. A set revision in neither is absent, and
 * the page names it by its id.
 */
export function revisionNumbers(detail: {
  versionSets: readonly { id: string; revision: number }[];
  deployments: readonly {
    versionSetRevisionId: string;
    versionSetRevision: number;
  }[];
  releaseRevisions?: readonly { id: string; revision: number }[] | undefined;
}): ReadonlyMap<string, number> {
  return new Map([
    ...(detail.releaseRevisions ?? []).map(
      (release) => [release.id, release.revision] as const,
    ),
    ...detail.deployments.map(
      (deployment) =>
        [
          deployment.versionSetRevisionId,
          deployment.versionSetRevision,
        ] as const,
    ),
    ...detail.versionSets.map(
      (version) => [version.id, version.revision] as const,
    ),
  ]);
}

/**
 * When the environment's observed revision was recorded. Delivery writes it as
 * a deployment finishes and never probes afterwards, so it is a dated claim
 * with no fresh or stale state.
 */
export function observation(environment: Environment, now = Date.now()) {
  return environment.observedAt === null
    ? "No runtime observation"
    : `Observed when the last deployment finished · ${relativeTime(environment.observedAt, now)}`;
}

const counted = (count: number, noun: string) =>
  `${count.toString()} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Whether one image check found the accepted artifact running. Every live
 * image is the accepted artifact, the desired release's, a retained worker
 * build or unexpected, so the accepted artifact runs exactly when some live
 * image is none of the others.
 */
function acceptedRunning(check: ImageCheck) {
  return (
    check.live.length >
    check.retained + check.unexpected.length + (check.desired ?? 0)
  );
}

/**
 * How one image check stands: the accepted digest running; the desired
 * release's digest running where Delivery has not accepted it, which is
 * what was asked for and not a wrong image; or a wrong one.
 */
export function imageCheckStanding(check: ImageCheck) {
  if (check.matches) return "accepted" as const;
  return check.unexpected.length === 0 && (check.desired ?? 0) > 0
    ? ("desired" as const)
    : ("wrong" as const);
}

/** What one image check found, in words, naming the release each digest belongs to. */
export function imageCheckSummary(check: ImageCheck) {
  const desired = check.desired ?? 0;
  const release =
    check.desiredRevision === undefined
      ? "the desired release"
      : `desired r${String(check.desiredRevision)}`;
  const lead = acceptedRunning(check)
    ? "runs the accepted digest"
    : desired > 0
      ? `runs ${release}'s digest, which Delivery has not accepted`
      : "does not run the accepted digest";
  return [
    lead,
    ...(acceptedRunning(check) && desired > 0
      ? [counted(desired, `image of ${release}`)]
      : []),
    ...(check.unexpected.length > 0
      ? [counted(check.unexpected.length, "unexpected image")]
      : []),
    ...(check.retained > 0
      ? [counted(check.retained, "retained worker build")]
      : []),
  ].join(" · ");
}
