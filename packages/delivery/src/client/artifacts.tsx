import { Link } from "@tanstack/react-router";
import type { BuildSourceKind } from "#shared/artifact-contract.ts";
import type { VersionSetRevision } from "#shared/contract.ts";
import type { BuildWithArtifacts } from "#shared/hub/hub-contract.ts";
import { artifactToolLinks } from "#shared/hub/artifact-links.ts";
import { Status } from "#client/components/status.tsx";
import { ShortSha, ToolLinks } from "#client/components/links.tsx";

/** What qualified a build that has no CI run to link. */
function evidenceSummary(sourceKind: BuildSourceKind) {
  switch (sourceKind) {
    case "ci": {
      return "CI verification";
    }
    case "upstream": {
      return "Original upstream bytes verified";
    }
    case "licensed-bundle": {
      return "Licensed bundle verification";
    }
    case "attested": {
      return "Operator attestation";
    }
    case "migrated": {
      return "Carried from its original qualified build";
    }
  }
}

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
                      <span>{evidenceSummary(build.sourceKind)}</span>
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
