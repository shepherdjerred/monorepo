import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DeliveryClientError } from "#shared/client.ts";
import { queries } from "#client/queries.ts";
import { Status } from "#client/components/status.tsx";
import { errorMessage } from "#client/components/notices.tsx";
import {
  DeploymentLink,
  SetRevision,
  type RevisionNumbers,
} from "./selection-facts.tsx";
import {
  blockingDeploymentId,
  inFlightStatus,
  inFlightWords,
  type Blocker,
} from "./environment-status.ts";
import { waitingPlan } from "./view.ts";

/**
 * Whether the deployment in flight is a running OpenTofu deployment whose
 * saved plan waits for a human. Only that deployment's detail says so, and
 * it is read only for a running deployment of a tofu recipe.
 */
export function usePlanWaiting(blocker: Blocker | null, recipeKind: string) {
  const lead = blocker?.kind === "in-flight" ? blocker.deployment : null;
  const detail = useQuery({
    ...queries.deployment(lead?.id ?? ""),
    enabled: lead?.status === "running" && recipeKind === "tofu",
  });
  return (
    lead?.status === "running" &&
    detail.data !== undefined &&
    waitingPlan(detail.data) !== null
  );
}

/** Why a request cannot be made here now, with a link to the deployment in the way. */
export function BlockedReason({
  blocker,
  planWaiting,
}: {
  blocker: Blocker;
  planWaiting: boolean;
}) {
  const link = <DeploymentLink id={blockingDeploymentId(blocker)} short />;
  switch (blocker.kind) {
    case "locked": {
      return (
        <>
          Deployment {link} failed and needs recovery, so this environment is
          locked. Requests are refused until it has been checked.
        </>
      );
    }
    case "in-flight": {
      return (
        <>
          Deployment {link} is{" "}
          {inFlightWords(blocker.deployment.status, planWaiting)}. Requests are
          refused until it finishes or is canceled.
        </>
      );
    }
    case "held": {
      return (
        <>
          Deployment {link} holds this environment. Requests are refused until
          it finishes.
        </>
      );
    }
  }
}

/**
 * The page's state under its title: a locked environment as an error, a
 * deployment in flight as information, and nothing while it is idle.
 */
export function EnvironmentNotice({
  blocker,
  planWaiting,
}: {
  blocker: Blocker | null;
  planWaiting: boolean;
}) {
  if (blocker === null) return null;
  const link = <DeploymentLink id={blockingDeploymentId(blocker)} short />;
  if (blocker.kind === "locked")
    return (
      <div className="notice error environment-notice">
        <p>
          <strong>Recovery required:</strong> deployment {link} failed and this
          environment is locked.
        </p>
        <p>
          A change may still be running outside Delivery. It must be checked
          before this environment unlocks; until then new requests and rollbacks
          are refused.
        </p>
      </div>
    );
  return (
    <p className="notice info environment-notice">
      <strong>In flight:</strong> deployment {link}{" "}
      {blocker.kind === "held"
        ? "holds this environment."
        : `is ${inFlightWords(blocker.deployment.status, planWaiting)}${blocker.behind > 0 ? ` and ${String(blocker.behind)} more wait behind it` : ""}.`}{" "}
      New requests wait until it finishes or is canceled.
    </p>
  );
}

/** The summary line's last part: the lock, the deployment in flight, or nothing. */
export function InFlightSummary({
  blocker,
  planWaiting,
  environmentId,
  revisions,
}: {
  blocker: Blocker | null;
  planWaiting: boolean;
  environmentId: string;
  revisions: RevisionNumbers;
}) {
  if (blocker === null) return "Nothing in flight";
  if (blocker.kind === "held")
    return (
      <>
        In flight: deployment <DeploymentLink id={blocker.deploymentId} short />
      </>
    );
  const { deployment } = blocker;
  const link = (status: string, label: ReactNode) => (
    <Link
      to="/deployments/$deploymentId"
      params={{ deploymentId: deployment.id }}
      className="environment-in-flight"
    >
      <Status value={status} label={label} />
    </Link>
  );
  if (blocker.kind === "locked") return link("failed", "Recovery required");
  return (
    <>
      In flight:{" "}
      {link(
        inFlightStatus(deployment.status, planWaiting),
        <>
          {deployment.kind}{" "}
          {deployment.platformSnapshot === null && (
            <>
              <SetRevision
                id={deployment.versionSetRevisionId}
                revisions={revisions}
              />{" "}
            </>
          )}
          {inFlightWords(deployment.status, planWaiting)}
        </>,
      )}
      {blocker.behind > 0 && (
        <>
          {" "}
          and{" "}
          <Link to="/deployments" search={{ environment: environmentId }}>
            {blocker.behind} more
          </Link>
        </>
      )}
    </>
  );
}

/**
 * A refused request in words, without the server's error code. A conflict
 * names the deployment in the way once the page knows it.
 */
export function RequestError({
  error,
  blocker,
  planWaiting,
  id,
}: {
  error: unknown;
  blocker: Blocker | null;
  planWaiting: boolean;
  id?: string;
}) {
  const conflict =
    error instanceof DeliveryClientError && error.code === "CONFLICT";
  return (
    <div className="notice error" role="alert" id={id}>
      {errorMessage(error)}
      {conflict && blocker !== null && (
        <>
          {" "}
          <BlockedReason blocker={blocker} planWaiting={planWaiting} />
        </>
      )}
    </div>
  );
}
