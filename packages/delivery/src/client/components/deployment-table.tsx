import { Link } from "@tanstack/react-router";
import type { Deployment } from "#shared/contract.ts";
import { Status } from "./status.tsx";
import { RelativeTime } from "./time.tsx";

export function DeploymentTable({
  deployments,
  empty,
}: {
  deployments: Deployment[];
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
              <td className="mono">
                {deployment.platformSnapshot?.source.id ??
                  deployment.versionSetRevisionId}
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
