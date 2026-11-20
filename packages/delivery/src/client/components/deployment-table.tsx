import { Link } from "@tanstack/react-router";
import type { DeploymentListItem } from "#shared/hub/hub-contract.ts";
import { Identifier, Revision } from "./identifier.tsx";
import { Status } from "./status.tsx";
import { RelativeTime } from "./time.tsx";

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
      >
        <Identifier value={deployment.platformSnapshot.source.id} />
      </Link>
    );
  return (
    <Link
      to="/versions/$versionSetId"
      params={{ versionSetId: deployment.versionSetRevisionId }}
    >
      <Revision revision={deployment.versionSetRevision} />
    </Link>
  );
}

export function DeploymentTable({
  deployments,
  empty,
}: {
  deployments: DeploymentListItem[];
  empty: string;
}) {
  if (deployments.length === 0) return <p className="empty">{empty}</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Deployment</th>
            <th scope="col">Status</th>
            <th scope="col">Release</th>
            <th scope="col">Requested</th>
          </tr>
        </thead>
        <tbody>
          {deployments.map((deployment) => (
            <tr key={deployment.id}>
              <th scope="row">
                <Link
                  to="/deployments/$deploymentId"
                  params={{ deploymentId: deployment.id }}
                >
                  {deployment.environmentId}
                </Link>
                <small>{deployment.kind}</small>
              </th>
              <td>
                <Status value={deployment.status} />
              </td>
              <td>
                <Release deployment={deployment} />
              </td>
              <td>
                <RelativeTime value={deployment.createdAt} />
                <small>{deployment.requestedBy}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
