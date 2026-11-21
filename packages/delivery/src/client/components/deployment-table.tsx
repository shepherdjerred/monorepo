import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { DeploymentListItem } from "#shared/hub/hub-contract.ts";
import {
  Identifier,
  Revision,
  revisionLabel,
  shortIdentifier,
} from "./identifier.tsx";
import { Status, statusLabel } from "./status.tsx";
import { RelativeTime, relativeTime, useNow } from "./time.tsx";

/** What a deployment releases, as people say it: `r274`, or the source build's short id. */
export function releaseLabel(deployment: DeploymentListItem) {
  return deployment.platformSnapshot === null
    ? revisionLabel(deployment.versionSetRevision)
    : `build ${shortIdentifier(deployment.platformSnapshot.source.id)}`;
}

/**
 * What a deployment releases: a platform release names its source build, and
 * every other kind names its set revision by number.
 */
function Release({ deployment }: { deployment: DeploymentListItem }) {
  if (deployment.platformSnapshot !== null)
    return (
      <Link
        to="/builds/$"
        params={{ _splat: deployment.platformSnapshot.source.id }}
        aria-label={`Source build ${deployment.platformSnapshot.source.id}`}
      >
        <Identifier value={deployment.platformSnapshot.source.id} />
      </Link>
    );
  return (
    <Link
      to="/versions/$versionSetId"
      params={{ versionSetId: deployment.versionSetRevisionId }}
      aria-label={`Version set ${revisionLabel(deployment.versionSetRevision)}`}
    >
      <Revision revision={deployment.versionSetRevision} />
    </Link>
  );
}

/** A deployment's status, and that its target waits for an operator when it does. */
export function DeploymentStatus({
  status,
  recoveryRequired,
}: {
  status: string;
  recoveryRequired: boolean;
}) {
  return (
    <Status
      value={status}
      label={
        recoveryRequired
          ? `${statusLabel(status)} · recovery required`
          : undefined
      }
    />
  );
}

function Row({
  deployment,
  showEnvironment,
}: {
  deployment: DeploymentListItem;
  showEnvironment: boolean;
}) {
  const at = useNow();
  const what = `${deployment.kind} ${releaseLabel(deployment)}`;
  const name: ReactNode = showEnvironment
    ? deployment.environmentId
    : deployment.kind;
  return (
    <tr>
      <th scope="row">
        <Link
          to="/deployments/$deploymentId"
          params={{ deploymentId: deployment.id }}
          aria-label={`Deployment${
            showEnvironment ? ` to ${deployment.environmentId}` : ""
          }, ${what}, ${relativeTime(deployment.createdAt, at)}`}
        >
          {name}
        </Link>
        {showEnvironment && <small>{deployment.kind}</small>}
      </th>
      <td data-label="Status">
        <DeploymentStatus
          status={deployment.status}
          recoveryRequired={deployment.recoveryRequired}
        />
      </td>
      <td data-label="Release">
        <Release deployment={deployment} />
      </td>
      <td data-label="Requested">
        <RelativeTime value={deployment.createdAt} />
        <small>{deployment.requestedBy}</small>
      </td>
    </tr>
  );
}

/**
 * Deployments newest first. A page already scoped to one environment omits
 * it, and each row is named by its kind instead. Narrow, each row stacks
 * under its own labels.
 */
export function DeploymentTable({
  deployments,
  empty,
  showEnvironment = true,
}: {
  deployments: DeploymentListItem[];
  empty: string;
  showEnvironment?: boolean;
}) {
  if (deployments.length === 0) return <p className="empty">{empty}</p>;
  return (
    <div className="table-scroll stack-table">
      <table>
        <thead>
          <tr>
            <th scope="col">{showEnvironment ? "Deployment" : "Kind"}</th>
            <th scope="col">Status</th>
            <th scope="col">Release</th>
            <th scope="col">Requested</th>
          </tr>
        </thead>
        <tbody>
          {deployments.map((deployment) => (
            <Row
              key={deployment.id}
              deployment={deployment}
              showEnvironment={showEnvironment}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
