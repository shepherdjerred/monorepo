import type { Deployment, Environment, Overview } from "#shared/contract.ts";
import { observation, versionLabel } from "./presentation.ts";

export function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}

export function ErrorNotice({ error }: { error: unknown }) {
  return (
    <div className="notice error" role="alert">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function EnvironmentCard({
  environment,
  overview,
  onSelect,
  onDeployment,
}: {
  environment: Environment;
  overview: Overview;
  onSelect: (environment: Environment) => void;
  onDeployment: (id: string) => void;
}) {
  const observed = observation(environment);
  const active = overview.deployments.find(
    (deployment) => deployment.id === environment.activeDeploymentId,
  );
  return (
    <article className="environment-card">
      <div className="card-top">
        <div>
          <p className="eyebrow">{environment.serviceId}</p>
          <h3>{environment.name}</h3>
        </div>
        <span className="policy">
          {environment.approvalRequired
            ? "Approval required"
            : environment.automatic
              ? "Automatic"
              : "On demand"}
        </span>
      </div>
      <dl className="versions">
        <div>
          <dt>Desired</dt>
          <dd>
            {versionLabel(
              environment.desiredVersionSetRevisionId,
              overview.versionSets,
            )}
          </dd>
        </div>
        <div>
          <dt>Observed</dt>
          <dd>
            {versionLabel(
              environment.observedVersionSetRevisionId,
              overview.versionSets,
            )}
          </dd>
        </div>
        <div>
          <dt>Accepted</dt>
          <dd>
            {versionLabel(
              environment.acceptedVersionSetRevisionId,
              overview.versionSets,
            )}
          </dd>
        </div>
      </dl>
      {environment.acceptedPlatformDeploymentId !== null && (
        <p className="notice">
          Accepted infrastructure{" "}
          <button
            className="text-button mono"
            onClick={() => {
              onDeployment(environment.acceptedPlatformDeploymentId ?? "");
            }}
          >
            {environment.acceptedPlatformDeploymentId}
          </button>
        </p>
      )}
      <p className={`freshness ${observed.fresh ? "fresh" : "stale"}`}>
        <span className="dot" />
        {observed.label}
      </p>
      {active?.recoveryRequired === true && (
        <p className="notice error">
          Environment locked · operator recovery required
        </p>
      )}
      <div className="card-bottom">
        <button
          className="text-button"
          onClick={() => {
            onSelect(environment);
          }}
        >
          Select release <span aria-hidden="true">↗</span>
        </button>
        {active !== undefined && (
          <button
            className="text-button"
            onClick={() => {
              onDeployment(active.id);
            }}
          >
            <Status value={active.status} />
          </button>
        )}
      </div>
    </article>
  );
}

export function DeploymentList({
  deployments,
  onSelect,
}: {
  deployments: Deployment[];
  onSelect: (id: string) => void;
}) {
  if (deployments.length === 0)
    return <p className="empty">No deployment requests yet.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Environment</th>
            <th>Release</th>
            <th>Status</th>
            <th>Requested</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {deployments.map((deployment) => (
            <tr key={deployment.id}>
              <td>
                <strong>{deployment.environmentId}</strong>
                <small>{deployment.kind}</small>
              </td>
              <td className="mono">
                {deployment.platformSnapshot?.source.id ??
                  deployment.versionSetRevisionId}
              </td>
              <td>
                <Status value={deployment.status} />
              </td>
              <td>
                <time dateTime={deployment.createdAt}>
                  {new Date(deployment.createdAt).toLocaleString()}
                </time>
                <small>{deployment.requestedBy}</small>
              </td>
              <td>
                <button
                  className="text-button"
                  aria-label={`Inspect deployment ${deployment.id}`}
                  onClick={() => {
                    onSelect(deployment.id);
                  }}
                >
                  Inspect <span aria-hidden="true">→</span>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
