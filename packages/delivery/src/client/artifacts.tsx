import { Link } from "@tanstack/react-router";
import type { VersionSetRevision } from "#shared/contract.ts";
import type { BuildWithArtifacts } from "#shared/hub/hub-contract.ts";
import { artifactToolLinks } from "#shared/hub/artifact-links.ts";
import { Status } from "#client/components/status.tsx";
import { ShortSha, ToolLinks } from "#client/components/links.tsx";

export function BuildCatalog({ builds }: { builds: BuildWithArtifacts[] }) {
  return (
    <section className="panel" aria-labelledby="builds-heading">
      <div className="section-heading">
        <h2 id="builds-heading">Build qualification</h2>
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
                <th scope="col">Service</th>
                <th scope="col">Source</th>
                <th scope="col">Qualification</th>
                <th scope="col">Artifacts</th>
                <th scope="col">Evidence</th>
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
                    <Link to="/builds/$" params={{ _splat: build.id }}>
                      <ShortSha sha={build.sourceRevision} />
                    </Link>
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
                  <td data-label="Artifacts">
                    <ul className="artifact-list">
                      {build.artifacts.map((artifact) => (
                        <li key={artifact.id}>
                          <span className="mono">
                            {artifact.component}@{artifact.version}
                          </span>
                          <ToolLinks links={artifactToolLinks(artifact)} />
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td data-label="Evidence">
                    {build.ciUrl === null ? (
                      <span>
                        {build.sourceKind === "upstream"
                          ? "Original upstream bytes verified"
                          : "Licensed bundle verification"}
                      </span>
                    ) : (
                      <a href={build.ciUrl}>
                        View CI<span aria-hidden="true"> ↗</span>
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
