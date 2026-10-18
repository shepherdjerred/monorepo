import type { Overview, VersionSetRevision } from "#shared/contract.ts";
import { Status } from "./components.tsx";

export function BuildCatalog({ builds }: { builds: Overview["builds"] }) {
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Build qualification</h2>
        <span className="muted">
          CI verification determines release eligibility
        </span>
      </div>
      {builds.length === 0 ? (
        <p className="empty">No builds registered.</p>
      ) : (
        <div className="table-scroll">
          <table className="build-catalog">
            <thead>
              <tr>
                <th>Service</th>
                <th>Source</th>
                <th>Qualification</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {builds.map((build) => (
                <tr key={build.id}>
                  <td data-label="Service">
                    <div>
                      <strong>{build.serviceId}</strong>
                      <small>{build.id}</small>
                    </div>
                  </td>
                  <td data-label="Source">
                    <span className="mono">
                      {build.sourceRevision.slice(0, 12)}
                    </span>
                  </td>
                  <td data-label="Qualification">
                    <div>
                      <Status value={build.status} />
                      <small>
                        {build.qualificationReason ??
                          (build.status === "pending"
                            ? "Waiting for exact source CI verification"
                            : "")}
                      </small>
                    </div>
                  </td>
                  <td data-label="Evidence">
                    {build.ciUrl === null ? (
                      <span>
                        {build.sourceKind === "upstream"
                          ? "Original upstream bytes verified"
                          : "Licensed bundle verification"}
                      </span>
                    ) : (
                      <a href={build.ciUrl} rel="noreferrer" target="_blank">
                        View CI ↗
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function SelectedArtifacts({
  version,
}: {
  version: VersionSetRevision;
}) {
  return (
    <details>
      <summary>Selected artifacts</summary>
      <dl className="component-list">
        {Object.entries(version.components).map(([component, artifact]) => (
          <div key={component}>
            <dt>{component}</dt>
            <dd>
              {artifact.version}
              <small className="mono">{artifact.digest}</small>
              <small>Source {artifact.sourceRevision}</small>
              {Object.entries(artifact.requires).map(([required, digest]) => (
                <small key={required} className="mono">
                  Requires {required} @ {digest}
                </small>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
