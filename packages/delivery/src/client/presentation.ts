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
 * What one image check found, in words. Every live image is the accepted
 * artifact, a retained worker build or unexpected, so the accepted artifact
 * runs exactly when some live image is neither of the other two.
 */
export function imageCheckSummary(check: ImageCheck) {
  const acceptedRunning =
    check.live.length > check.retained + check.unexpected.length;
  return [
    acceptedRunning
      ? "runs the accepted digest"
      : "does not run the accepted digest",
    ...(check.unexpected.length > 0
      ? [counted(check.unexpected.length, "unexpected image")]
      : []),
    ...(check.retained > 0
      ? [counted(check.retained, "retained worker build")]
      : []),
  ].join(" · ");
}
